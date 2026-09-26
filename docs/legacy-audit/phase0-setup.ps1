# Phase 0 setup for the patient dashboard probe (local dev stack only).
#
# What it does (all local, synthetic data only):
#   1. Starts the OpenEMR dev stack (docker/development-easy-light).
#   2. Waits until OpenEMR answers on http://localhost:8300.
#   3. If there are fewer than 5 patients, generates 10 synthetic patients
#      with Synthea (OpenEMR's own dev tool). Existing data is not wiped.
#   4. Prints the 5 most data-rich patients with per-card counts, and a
#      clickable dashboard link for each.
#   5. Prints the other links you need for the run-through.
#
# Run from anywhere, in Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File docs\legacy-audit\phase0-setup.ps1
# Options:
#   -Patients 20      generate a different number of patients
#   -ForceImport      generate patients even if some already exist

param(
    [int]$Patients = 10,
    [switch]$ForceImport
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$compose = Join-Path $repo 'docker\development-easy-light\docker-compose.yml'
$dockerBin = 'C:\Program Files\Docker\Docker\resources\bin'
if (Test-Path $dockerBin) { $env:Path = "$dockerBin;" + $env:Path }
$env:COMPOSE_PROJECT_NAME = 'agentforge-week1'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

Step 'Checking Docker Desktop is running'
docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running. Start it, wait for "Engine running", then re-run this script.' }

Step 'Starting the OpenEMR dev stack (first start can take 5-10 minutes)'
docker compose -f $compose up --detach --wait --wait-timeout 900
if ($LASTEXITCODE -ne 0) { throw 'The stack did not become healthy. Run: docker compose -f docker\development-easy-light\docker-compose.yml logs openemr' }

function Container($service) {
    $name = docker ps --filter "label=com.docker.compose.project=agentforge-week1" `
        --filter "label=com.docker.compose.service=$service" --format '{{.Names}}' | Select-Object -First 1
    if (-not $name) { throw "No running '$service' container for project agentforge-week1." }
    return $name
}
$openemr = Container 'openemr'
$mysql = Container 'mysql'

Step 'Waiting for OpenEMR to answer on http://localhost:8300'
$deadline = (Get-Date).AddMinutes(15)
do {
    try { $ok = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 'http://localhost:8300/interface/login/login.php').StatusCode -eq 200 }
    catch { $ok = $false }
    if (-not $ok) { Start-Sleep -Seconds 10 }
} until ($ok -or (Get-Date) -gt $deadline)
if (-not $ok) { throw 'OpenEMR did not come up within 15 minutes. Check: docker logs ' + $openemr }

function Sql($query) {
    docker exec -e MYSQL_PWD=openemr $mysql mariadb -uopenemr openemr --batch --raw -e $query
}

$count = [int](Sql 'SELECT COUNT(*) FROM patient_data;' | Select-Object -Skip 1 -First 1)
Step "Patients in the database: $count"
if ($ForceImport -or $count -lt 5) {
    Step "Generating $Patients synthetic patients with Synthea (a few seconds each; the first run downloads Synthea)"
    docker exec $openemr /root/devtools import-random-patients $Patients
    if ($LASTEXITCODE -ne 0) { throw 'Patient import failed. Copy the output above to Claude.' }
} else {
    Write-Host 'Skipping import (use -ForceImport to add more).'
}

Step 'Most data-rich patients (counts per dashboard card)'
$query = @"
SELECT * FROM (
  SELECT p.pid, CONCAT(p.fname, ' ', p.lname) AS name, p.DOB AS dob, p.pubpid AS mrn,
    (SELECT COUNT(*) FROM lists l WHERE l.pid = p.pid AND l.type = 'allergy') AS allergies,
    (SELECT COUNT(*) FROM lists l WHERE l.pid = p.pid AND l.type = 'medical_problem') AS problems,
    (SELECT COUNT(*) FROM lists l WHERE l.pid = p.pid AND l.type = 'medication') AS medications,
    (SELECT COUNT(*) FROM prescriptions r WHERE r.patient_id = p.pid) AS prescriptions,
    (SELECT COUNT(*) FROM care_team_member m JOIN care_teams t ON m.care_team_id = t.id WHERE t.pid = p.pid) AS care_team,
    (SELECT COUNT(*) FROM pnotes n WHERE n.pid = p.pid AND n.deleted = 0) AS notes
  FROM patient_data p
) x
ORDER BY (allergies + problems + medications + prescriptions + care_team + notes) DESC
LIMIT 5;
"@
$rows = Sql $query | ConvertFrom-Csv -Delimiter "`t"
$rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

$emptyQuery = @"
SELECT p.pid, CONCAT(p.fname, ' ', p.lname) AS name FROM patient_data p
WHERE NOT EXISTS (SELECT 1 FROM lists l WHERE l.pid = p.pid)
  AND NOT EXISTS (SELECT 1 FROM prescriptions r WHERE r.patient_id = p.pid)
LIMIT 1;
"@
$empty = Sql $emptyQuery | ConvertFrom-Csv -Delimiter "`t" | Select-Object -First 1

Step 'Your links (log in first as admin / pass)'
Write-Host '  OpenEMR login ......... http://localhost:8300/'
Write-Host '  Patient finder ........ http://localhost:8300/interface/main/finder/dynamic_finder.php'
if ($rows) {
    $top = $rows | Select-Object -First 1
    Write-Host "  Probe patient ......... $($top.name) (pid $($top.pid))"
    Write-Host "    Dashboard ........... http://localhost:8300/interface/patient_file/summary/demographics.php?set_pid=$($top.pid)"
    Write-Host '  Other rich patients:'
    $rows | Select-Object -Skip 1 | ForEach-Object {
        Write-Host "    $($_.name) .... http://localhost:8300/interface/patient_file/summary/demographics.php?set_pid=$($_.pid)"
    }
}
if ($empty) {
    Write-Host "  Empty-state patient ... $($empty.name): http://localhost:8300/interface/patient_file/summary/demographics.php?set_pid=$($empty.pid)"
} else {
    Write-Host '  Empty-state patient ... none found; create one via Patient > New/Search (just a name and DOB).'
}
Write-Host '  API settings (look only) http://localhost:8300/interface/super/edit_globals.php  (Connectors tab)'
Write-Host '  FHIR API check ........ https://localhost:9300/apis/default/fhir/metadata  (accept the self-signed cert warning)'
Write-Host '  phpMyAdmin ............ http://localhost:8310/'

Step 'Done. Next: follow docs\legacy-audit\PHASE0-WALKTHROUGH.md, then send Claude the output above plus your notes.'
