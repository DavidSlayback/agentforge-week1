param(
  [string]$BaseUrl = $(if ($env:AGENTFORGE_BASE_URL) { $env:AGENTFORGE_BASE_URL } else { 'http://127.0.0.1:8787' })
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')

function Invoke-AgentForge {
  param([string]$Method, [string]$Path, [object]$Body)
  $params = @{ Method = $Method; Uri = "$base$Path"; UseBasicParsing = $true }
  if ($null -ne $Body) { $params.ContentType = 'application/json'; $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
  try {
    $response = Invoke-WebRequest @params
    $text = [string]$response.Content
    $parsed = $null
    try { $parsed = ConvertFrom-Json -InputObject $text } catch { $parsed = $text }
    return [pscustomobject]@{ status = [int]$response.StatusCode; body = $parsed; text = $text }
  } catch {
    $response = $_.Exception.Response
    if ($null -eq $response) { throw }
    $reader = [IO.StreamReader]::new($response.GetResponseStream())
    $text = $reader.ReadToEnd()
    $parsed = $null
    try { $parsed = ConvertFrom-Json -InputObject ([string]$text) } catch { $parsed = $text }
    return [pscustomobject]@{ status = [int]$response.StatusCode; body = $parsed; text = $text }
  }
}

function Assert-Status($Result, [int]$Expected, [string]$Name) {
  if ($Result.status -ne $Expected) { throw "$Name expected HTTP $Expected but received $($Result.status): $($Result.text)" }
  $Result
}

$health = Assert-Status (Invoke-AgentForge 'GET' '/health' $null) 200 'health'
$ready = Assert-Status (Invoke-AgentForge 'GET' '/ready' $null) 200 'ready'
$briefing = Assert-Status (Invoke-AgentForge 'POST' '/v1/briefings' @{ patient_uuid = 'fixture-patient-001'; case_id = 'complete_return_visit'; clinician_uuid = 'fixture-physician-001'; authorization = @{ status = 'authorized'; scope = 'read-briefing' } }) 200 'briefing'
if ($briefing.body.disposition -ne 'complete' -or -not $briefing.body.correlation_id) { throw 'briefing did not return a complete response with a correlation ID' }
$followUp = Assert-Status (Invoke-AgentForge 'POST' "/v1/conversations/$($briefing.body.correlation_id)/messages" @{ patient_uuid = 'fixture-patient-001'; message = 'What changed since the last visit?'; clinician_uuid = 'fixture-physician-001'; authorization = @{ status = 'authorized'; scope = 'read-briefing' } }) 200 'follow-up'
if ($followUp.body.correlation_id -ne $briefing.body.correlation_id -or $followUp.body.patient.patient_ref -ne 'fixture-patient-001') { throw 'follow-up lost conversation or patient scope' }
$denied = Assert-Status (Invoke-AgentForge 'POST' '/v1/briefings' @{ patient_uuid = 'fixture-patient-001'; case_id = 'complete_return_visit'; clinician_uuid = 'fixture-physician-001'; authorization = @{ status = 'denied'; scope = 'read-briefing' } }) 200 'denied briefing'
if ($denied.body.disposition -ne 'blocked' -or $null -ne $denied.body.patient) { throw 'denied briefing did not fail closed' }
$crossPatient = Assert-Status (Invoke-AgentForge 'POST' "/v1/conversations/$($briefing.body.correlation_id)/messages" @{ patient_uuid = 'fixture-patient-006'; message = 'What changed?'; clinician_uuid = 'fixture-physician-001'; authorization = @{ status = 'authorized'; scope = 'read-briefing' } }) 200 'cross-patient follow-up'
if ($crossPatient.body.disposition -ne 'blocked' -or $null -ne $crossPatient.body.patient) { throw 'cross-patient follow-up did not fail closed' }
$invalid = Assert-Status (Invoke-AgentForge 'POST' '/v1/briefings' @{ patient_uuid = 42; clinician_uuid = 'fixture-physician-001'; authorization = @{ status = 'authorized'; scope = 'read-briefing' } }) 400 'invalid briefing request'
$metrics = Assert-Status (Invoke-AgentForge 'GET' '/v1/metrics' $null) 200 'metrics'
$traces = Assert-Status (Invoke-AgentForge 'GET' '/v1/traces' $null) 200 'traces'
$observability = Assert-Status (Invoke-AgentForge 'GET' '/observability' $null) 200 'observability'

[pscustomobject]@{
  base_url = $base
  health = $health.status
  ready = $ready.status
  briefing = $briefing.body.disposition
  follow_up_correlation_id = $followUp.body.correlation_id
  denied = $denied.body.disposition
  cross_patient = $crossPatient.body.disposition
  invalid_request = $invalid.status
  metrics = $metrics.status
  traces = $traces.status
  observability = $observability.status
} | ConvertTo-Json -Compress
