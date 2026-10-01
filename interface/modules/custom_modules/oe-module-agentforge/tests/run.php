<?php

/**
 * Dependency-free tests for the AgentForge module's pure code: HMAC signing
 * and verification against the vectors shared with the Node client,
 * canonicalization, clock skew, nonce replay, context tokens, access policy,
 * idempotency keys and the idempotent writer (database layer stubbed), and
 * the lab row plan, and the AgentForgeApi dispatcher with the OpenEMR runtime
 * stubbed (ACL, cross-patient reads and links, allowlist for every issuer,
 * separate signing and context secrets), the Ed25519 launcher tokens, list
 * provenance and read auditing. Runs on plain PHP 8.4 with ext-hash, ext-json
 * and ext-sodium (the enforced .githooks/pre-commit runs it):
 *
 *   php tests/run.php [path/to/hmac-vectors.json]
 *
 * When ext-sodium is not loaded (the Windows zip build ships php_sodium.dll
 * but does not enable it), the runner re-executes itself once with
 * `-d extension=sodium`; if that fails too it exits 1, never skips.
 *
 * The vectors default to agentforge/test/fixtures/hmac-vectors.json in this
 * repository; pass the path explicitly when the module is run elsewhere.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

if (!function_exists('sodium_crypto_sign_detached')) {
    if (getenv('AGENTFORGE_TESTS_SODIUM_REEXEC') === '1') {
        fwrite(STDERR, "ext-sodium is required (launcher tokens are Ed25519); enable it in php.ini.\n");
        exit(1);
    }
    $command = [PHP_BINARY];
    $extensionDir = dirname(PHP_BINARY) . DIRECTORY_SEPARATOR . 'ext';
    if (is_dir($extensionDir)) {
        $command = [...$command, '-d', 'extension_dir=' . $extensionDir];
    }
    $command = [...$command, '-d', 'extension=sodium', __FILE__, ...array_slice($argv, 1)];
    putenv('AGENTFORGE_TESTS_SODIUM_REEXEC=1');
    $process = proc_open($command, [STDIN, STDOUT, STDERR], $pipes);
    exit(is_resource($process) ? proc_close($process) : 1);
}

require_once dirname(__DIR__) . '/src/autoload.php';

use OpenEMR\Modules\AgentForge\Domain\Actor;
use OpenEMR\Modules\AgentForge\Domain\ContextClaims;
use OpenEMR\Modules\AgentForge\Domain\DocumentType;
use OpenEMR\Modules\AgentForge\Domain\DocumentWriteRequest;
use OpenEMR\Modules\AgentForge\Domain\IdempotencyKey;
use OpenEMR\Modules\AgentForge\Domain\LabResultsRequest;
use OpenEMR\Modules\AgentForge\Domain\ListItemKind;
use OpenEMR\Modules\AgentForge\Http\AccessPolicy;
use OpenEMR\Modules\AgentForge\Http\ApiError;
use OpenEMR\Modules\AgentForge\Http\CanonicalRequest;
use OpenEMR\Modules\AgentForge\Http\ContextTokenVerifier;
use OpenEMR\Modules\AgentForge\Http\HmacVerifier;
use OpenEMR\Modules\AgentForge\Http\RequestAuthenticator;
use OpenEMR\Modules\AgentForge\Http\SignedRequest;
use OpenEMR\Modules\AgentForge\Persistence\AuditSink;
use OpenEMR\Modules\AgentForge\Persistence\IdempotentWriter;
use OpenEMR\Modules\AgentForge\Persistence\LedgerEntry;
use OpenEMR\Modules\AgentForge\Persistence\NonceStore;
use OpenEMR\Modules\AgentForge\Persistence\WriteLedger;
use OpenEMR\Modules\AgentForge\Persistence\WriteOutcome;
use OpenEMR\Modules\AgentForge\Read\LabHistoryAssembler;
use OpenEMR\Modules\AgentForge\Write\ClinicalListWriter;
use OpenEMR\Modules\AgentForge\Write\LabRowPlanner;
use OpenEMR\Modules\AgentForge\Api\AclChecker;
use OpenEMR\Modules\AgentForge\Api\AgentForgeApi;
use OpenEMR\Modules\AgentForge\Api\ChartGateway;
use OpenEMR\Modules\AgentForge\Domain\PatientUuid;
use OpenEMR\Modules\AgentForge\Launch\LaunchGrant;
use OpenEMR\Modules\AgentForge\Launch\LaunchScope;
use OpenEMR\Modules\AgentForge\Launch\LaunchSigningKey;
use OpenEMR\Modules\AgentForge\Launch\LaunchTokenMinter;
use OpenEMR\Modules\AgentForge\Http\LaunchVerifyKey;
use OpenEMR\Modules\AgentForge\Domain\ListItemProvenance;

final class InMemoryNonceStore implements NonceStore
{
    /** @var array<string, int> */
    public array $nonces = [];

    public function claim(string $nonce, int $expiresAt, int $now): bool
    {
        if (isset($this->nonces[$nonce])) {
            return false;
        }
        $this->nonces[$nonce] = $expiresAt;
        return true;
    }
}

class InMemoryLedger implements WriteLedger
{
    /** @var array<string, LedgerEntry> */
    public array $rows = [];
    /** @var list<string> */
    public array $locks = [];
    public int $transactions = 0;
    /** Simulates a lookup bug that ignores the patient (cross-patient mutation). */
    public bool $ignorePid = false;

    public function acquireLock(string $key): void
    {
        $this->locks[] = 'acquire:' . $key;
    }

    public function releaseLock(string $key): void
    {
        $this->locks[] = 'release:' . $key;
    }

    public function find(string $key): ?LedgerEntry
    {
        return $this->rows[$key] ?? null;
    }

    public function insert(LedgerEntry $entry): void
    {
        if (isset($this->rows[$entry->idempotencyKey])) {
            throw new RuntimeException('duplicate ledger key');
        }
        $this->rows[$entry->idempotencyKey] = $entry;
    }

    public function findDocument(int $pid, int $documentId): ?LedgerEntry
    {
        foreach ($this->rows as $row) {
            if (($this->ignorePid || $row->pid === $pid) && $row->documentId === $documentId && str_starts_with($row->operation, 'doc:')) {
                return $row;
            }
        }
        return null;
    }

    public function findBySourceDocument(int $pid, string $operation, int $documentId): ?LedgerEntry
    {
        foreach ($this->rows as $row) {
            if (($this->ignorePid || $row->pid === $pid) && $row->documentId === $documentId && $row->operation === $operation) {
                return $row;
            }
        }
        return null;
    }

    public function findLabResultsForPatient(int $pid): array
    {
        $rows = [];
        foreach ($this->rows as $row) {
            if (($this->ignorePid || $row->pid === $pid) && $row->operation === 'lab') {
                $rows[] = $row;
            }
        }
        return $rows;
    }

    public function transaction(callable $work): mixed
    {
        $this->transactions++;
        $snapshot = $this->rows;
        try {
            return $work();
        } catch (Throwable $error) {
            $this->rows = $snapshot;
            throw $error;
        }
    }
}

final class RecordingAudit implements AuditSink
{
    /** @var list<string> */
    public array $events = [];

    /** @var list<string> */
    public array $reads = [];

    public function recordWrite(string $operation, Actor $actor, int $pid, ?int $documentId, int $rowCount): void
    {
        $this->events[] = sprintf('%s:%d:%s:%d:%s', $operation, $pid, $documentId ?? '-', $rowCount, $actor->issuer);
    }

    public function recordRead(string $operation, Actor $actor, int $pid, ?int $documentId, int $rowCount): void
    {
        $this->reads[] = sprintf('%s:%d:%s:%d:%s', $operation, $pid, $documentId ?? '-', $rowCount, $actor->issuer);
    }
}

$failures = 0;
$passes = 0;

function check(string $name, callable $test): void
{
    global $failures, $passes;
    try {
        $test();
        $passes++;
        echo "ok   - $name\n";
    } catch (Throwable $error) {
        $failures++;
        echo "FAIL - $name: " . $error->getMessage() . "\n";
    }
}

function same(mixed $expected, mixed $actual, string $label = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(sprintf('%s expected %s, got %s', $label, var_export($expected, true), var_export($actual, true)));
    }
}

function throwsApiError(callable $fn, int $status, string $code): void
{
    try {
        $fn();
    } catch (ApiError $error) {
        same($status, $error->httpStatus, 'status');
        same($code, $error->errorCode, 'code');
        return;
    }
    throw new RuntimeException("expected ApiError $status $code");
}

/**
 * @param array<string, mixed> $vector
 * @return array<string, string>
 */
function headersFor(array $vector): array
{
    $headers = [
        'x-agentforge-key-id' => 'v1',
        'x-agentforge-timestamp' => (string) $vector['timestamp'],
        'x-agentforge-nonce' => (string) $vector['nonce'],
        'x-agentforge-content-sha256' => (string) $vector['body_sha256'],
        'x-agentforge-signature' => (string) $vector['signature'],
    ];
    if (is_string($vector['context_token'] ?? null)) {
        $headers['x-agentforge-context-token'] = $vector['context_token'];
    }
    return $headers;
}

$vectorPath = $argv[1] ?? (dirname(__DIR__, 5) . '/agentforge/test/fixtures/hmac-vectors.json');
if (!is_file($vectorPath)) {
    fwrite(STDERR, "HMAC vectors not found at $vectorPath; pass the path as the first argument.\n");
    exit(1);
}
$vectors = json_decode((string) file_get_contents($vectorPath), true, 64, JSON_THROW_ON_ERROR);
$secret = $vectors['secret'];
$verifier = new HmacVerifier($secret);

check('write key matches the shared vector', function () use ($vectors, $secret): void {
    same($vectors['write_key_hex'], bin2hex(HmacVerifier::deriveWriteKey($secret)));
});

foreach ($vectors['signature_vectors'] as $vector) {
    check("shared vector {$vector['name']}: canonical string and signature match Node", function () use ($vector, $verifier): void {
        $body = $vector['body'] === '' ? [] : json_decode($vector['body'], true, 32, JSON_THROW_ON_ERROR);
        $canonical = new CanonicalRequest(
            $vector['method'],
            $vector['query']['route'],
            $vector['query']['site'],
            $vector['method'] === 'POST' ? ($body['patient_uuid'] ?? '') : ($vector['query']['patient_uuid'] ?? ''),
            $vector['method'] === 'POST' ? ($body['content_sha256'] ?? '') : '',
            hash('sha256', $vector['body']),
            (string) $vector['timestamp'],
            $vector['nonce'],
            $vector['query'],
            is_string($vector['context_token']) ? hash('sha256', $vector['context_token']) : '',
        );
        same($vector['body_sha256'], hash('sha256', $vector['body']), 'body sha');
        same($vector['canonical'], $canonical->toString(), 'canonical');
        same($vector['signature'], $verifier->sign($canonical), 'signature');
    });
    check("shared vector {$vector['name']}: authenticator accepts the Node-signed request", function () use ($vector, $verifier): void {
        $authenticator = new RequestAuthenticator($verifier, new InMemoryNonceStore());
        $signed = $authenticator->authenticate($vector['method'], $vector['query'], headersFor($vector), $vector['body'], $vector['timestamp'] + 5);
        same($vector['query']['route'], $signed->route);
        same($vector['context_token'], $signed->contextToken);
    });
}

$post = $vectors['signature_vectors'][0];
$get = $vectors['signature_vectors'][1];

check('canonical query is order-independent and "-" when empty', function (): void {
    same('route=documents&site=default', CanonicalRequest::canonicalQuery(['site' => 'default', 'route' => 'documents']));
    same('-', CanonicalRequest::canonicalQuery([]));
});

check('tampered body is rejected as signature_invalid', function () use ($post, $verifier): void {
    $tampered = str_replace('filled-lab-a.pdf', 'filled-lab-b.pdf', $post['body']);
    $headers = headersFor($post);
    $headers['x-agentforge-content-sha256'] = hash('sha256', $tampered);
    throwsApiError(fn() => (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('POST', $post['query'], $headers, $tampered, $post['timestamp']), 401, 'signature_invalid');
});

check('body not matching the signed body hash is rejected', function () use ($post, $verifier): void {
    throwsApiError(fn() => (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('POST', $post['query'], headersFor($post), $post['body'] . ' ', $post['timestamp']), 401, 'signature_invalid');
});

check('tampered query parameter is rejected (query is signed)', function () use ($get, $verifier): void {
    $query = $get['query'];
    $query['source_document_id'] = '58';
    throwsApiError(fn() => (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('GET', $query, headersFor($get), '', $get['timestamp']), 401, 'signature_invalid');
});

check('swapped context token is rejected (token hash is signed)', function () use ($get, $verifier): void {
    $headers = headersFor($get);
    $headers['x-agentforge-context-token'] = $headers['x-agentforge-context-token'] . 'x';
    throwsApiError(fn() => (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('GET', $get['query'], $headers, '', $get['timestamp']), 401, 'signature_invalid');
});

check('wrong secret is rejected', function () use ($post): void {
    throwsApiError(fn() => (new RequestAuthenticator(new HmacVerifier('another-secret'), new InMemoryNonceStore()))->authenticate('POST', $post['query'], headersFor($post), $post['body'], $post['timestamp']), 401, 'signature_invalid');
});

check('missing signature headers are rejected', function () use ($post, $verifier): void {
    throwsApiError(fn() => (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('POST', $post['query'], [], $post['body'], $post['timestamp']), 401, 'signature_invalid');
});

check('clock skew: +/-300 s accepted, 301 s rejected either way', function () use ($post, $verifier): void {
    (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('POST', $post['query'], headersFor($post), $post['body'], $post['timestamp'] + 300);
    (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('POST', $post['query'], headersFor($post), $post['body'], $post['timestamp'] - 300);
    throwsApiError(fn() => (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('POST', $post['query'], headersFor($post), $post['body'], $post['timestamp'] + 301), 401, 'timestamp_skew');
    throwsApiError(fn() => (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('POST', $post['query'], headersFor($post), $post['body'], $post['timestamp'] - 400), 401, 'timestamp_skew');
});

check('nonce replay: the same signed request twice is 409 nonce_replayed', function () use ($post, $verifier): void {
    $authenticator = new RequestAuthenticator($verifier, new InMemoryNonceStore());
    $authenticator->authenticate('POST', $post['query'], headersFor($post), $post['body'], $post['timestamp']);
    throwsApiError(fn() => $authenticator->authenticate('POST', $post['query'], headersFor($post), $post['body'], $post['timestamp']), 409, 'nonce_replayed');
});

check('a rejected (unsigned) request does not burn its nonce', function () use ($post, $verifier): void {
    $nonces = new InMemoryNonceStore();
    $authenticator = new RequestAuthenticator($verifier, $nonces);
    $bad = headersFor($post);
    $bad['x-agentforge-signature'] = str_repeat('A', 43);
    throwsApiError(fn() => $authenticator->authenticate('POST', $post['query'], $bad, $post['body'], $post['timestamp']), 401, 'signature_invalid');
    same([], $nonces->nonces);
    $authenticator->authenticate('POST', $post['query'], headersFor($post), $post['body'], $post['timestamp']);
});

check('nonce TTL covers the full skew window', function () use ($post, $verifier): void {
    $nonces = new InMemoryNonceStore();
    (new RequestAuthenticator($verifier, $nonces))->authenticate('POST', $post['query'], headersFor($post), $post['body'], $post['timestamp']);
    same($post['timestamp'] + 600, $nonces->nonces[$post['nonce']]);
});

check('query values outside the signed alphabet are rejected', function () use ($get, $verifier): void {
    $query = $get['query'];
    $query['patient_uuid'] = 'a b';
    throwsApiError(fn() => (new RequestAuthenticator($verifier, new InMemoryNonceStore()))->authenticate('GET', $query, headersFor($get), '', $get['timestamp']), 400, 'invalid_request');
});

$tokenVector = $vectors['context_token_vectors'][0];
$contextVerifier = new ContextTokenVerifier($secret);

check('context token issued by Node verifies in PHP', function () use ($tokenVector, $contextVerifier): void {
    $claims = $contextVerifier->verify($tokenVector['token'], $tokenVector['verify_at']);
    foreach (['patient_uuid' => 'patientUuid', 'clinician_uuid' => 'clinicianUuid', 'scope' => 'scope', 'issuer' => 'issuer', 'authn' => 'authn', 'acl' => 'acl', 'expires_at' => 'expiresAt'] as $field => $property) {
        same($tokenVector['expected'][$field], $claims->$property, $field);
    }
});

check('context token: expired, tampered and wrong-secret tokens are context_invalid', function () use ($tokenVector, $contextVerifier): void {
    throwsApiError(fn() => $contextVerifier->verify($tokenVector['token'], $tokenVector['expected']['expires_at']), 401, 'context_invalid');
    throwsApiError(fn() => $contextVerifier->verify('x' . $tokenVector['token'], $tokenVector['verify_at']), 401, 'context_invalid');
    throwsApiError(fn() => (new ContextTokenVerifier('another-secret'))->verify($tokenVector['token'], $tokenVector['verify_at']), 401, 'context_invalid');
});

check('context token: TTL beyond 300 s is rejected', function () use ($secret, $contextVerifier): void {
    $encoded = HmacVerifier::base64UrlEncode(json_encode(['patient_uuid' => 'p', 'clinician_uuid' => 'c', 'scope' => 'write-source-document', 'issuer' => 'synthetic-demo', 'authn' => 'synthetic', 'role' => 'clinician', 'acl' => 'write', 'expires_at' => 1000 + 301], JSON_THROW_ON_ERROR));
    throwsApiError(fn() => $contextVerifier->verify($encoded . '.' . ContextTokenVerifier::sign($encoded, $secret), 1000), 401, 'context_invalid');
});

$patient = 'a2c37f7f-1076-4172-b17a-bee8bb8d2da6';
$signedFor = static fn(?string $patientUuid): SignedRequest => new SignedRequest('POST', 'documents', 'default', $patientUuid, [], [], 'token', 1, 'n');
$claimsFor = static fn(string $patientUuid, string $issuer, string $authn = 'synthetic', string $scope = 'write-source-document'): ContextClaims => new ContextClaims($patientUuid, 'c', $scope, $issuer, $authn, $scope === 'read-briefing' ? 'read' : 'write', 2);
$policy = new AccessPolicy(AccessPolicy::parseAllowlist(" $patient , not-a-uuid"));

check('access policy: allowlisted synthetic-demo patient is authorized', function () use ($policy, $signedFor, $claimsFor, $patient): void {
    $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor($patient), $claimsFor($patient, 'synthetic-demo'));
});

check('access policy: non-allowlisted synthetic-demo patient is 403 demo_patient_not_allowed', function () use ($policy, $signedFor, $claimsFor): void {
    $other = '11111111-2222-4333-8444-555555555555';
    throwsApiError(fn() => $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor($other), $claimsFor($other, 'synthetic-demo')), 403, 'demo_patient_not_allowed');
});

check('access policy: token for another patient is 403 patient_scope_mismatch', function () use ($policy, $signedFor, $claimsFor, $patient): void {
    throwsApiError(fn() => $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor('11111111-2222-4333-8444-555555555555'), $claimsFor($patient, 'synthetic-demo')), 403, 'patient_scope_mismatch');
});

check('access policy: read-briefing token cannot write', function () use ($policy, $signedFor, $claimsFor, $patient): void {
    throwsApiError(fn() => $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor($patient), $claimsFor($patient, 'synthetic-demo', 'synthetic', 'read-briefing')), 403, 'acl_denied');
    throwsApiError(fn() => $policy->authorize(AccessPolicy::policyFor('POST', 'clinical-list-items'), $signedFor($patient), $claimsFor($patient, 'synthetic-demo')), 403, 'acl_denied');
});

check('access policy: openemr-module issuer needs an openemr-session authn; unknown issuers fail', function () use ($policy, $signedFor, $claimsFor, $patient): void {
    $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor($patient), $claimsFor($patient, 'openemr-module', 'openemr-session'));
    throwsApiError(fn() => $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor($patient), $claimsFor($patient, 'openemr-module', 'synthetic')), 401, 'context_invalid');
    throwsApiError(fn() => $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor($patient), $claimsFor($patient, 'somebody-else')), 401, 'context_invalid');
});

check('access policy: unknown route is 404', function (): void {
    throwsApiError(fn() => AccessPolicy::policyFor('DELETE', 'documents'), 404, 'route_not_found');
});

// E9 launcher (public/index.php -> LaunchTokenMinter): the tokens a logged-in
// OpenEMR session hands to the W2 service. W3 H1: they are Ed25519-signed with
// a key only the openemr container holds. The synthetic test keypair and the
// write-token vector are shared with Node (hmac-vectors.json
// launch_token_vectors; agentforge/test/w3-launch-trust.test.js).
$launchVectors = $vectors['launch_token_vectors'];
$launchSigningKey = LaunchSigningKey::fromBase64Seed($launchVectors['signing_key_base64'], $launchVectors['verify_key_base64']);
$launchVerifyKey = LaunchVerifyKey::fromBase64($launchVectors['verify_key_base64']);
const LAUNCH_VECTOR_NOW = 1790000000;
const LAUNCH_VECTOR_CLINICIAN = '6f1e2d3c-4b5a-4968-8776-655443322110';

/**
 * @param list<string> $held "section/value" or "section/value/return" entries
 * @return callable(string, string, string): bool
 */
function fakeAcl(array $held): callable
{
    return static fn(string $section, string $value, string $returnValue): bool => in_array($returnValue === '' ? "$section/$value" : "$section/$value/$returnValue", $held, true);
}

check('launcher grant: every ACO the REST reads enforce is required (demo, med, docs, encounters notes and auth_a)', function (): void {
    same([['patients', 'demo'], ['patients', 'med'], ['patients', 'docs'], ['encounters', 'notes'], ['encounters', 'auth_a']], LaunchTokenMinter::REQUIRED_READ_ACOS, 'aco list');
    $all = ['patients/demo', 'patients/med', 'patients/docs', 'encounters/notes', 'encounters/auth_a'];
    foreach ($all as $missing) {
        same(LaunchGrant::None, LaunchTokenMinter::grant(fakeAcl(array_values(array_diff($all, [$missing]))), true, true), "without $missing");
    }
    same(LaunchGrant::ReadOnly, LaunchTokenMinter::grant(fakeAcl($all), true, true), 'all read acos, no docs write');
});

check('launcher grant: only designated (live-allowlisted) patients; upload also needs docs write and the write allowlist', function (): void {
    $read = ['patients/demo', 'patients/med', 'patients/docs', 'encounters/notes', 'encounters/auth_a'];
    $write = [...$read, 'patients/docs/write'];
    same(LaunchGrant::NotDesignated, LaunchTokenMinter::grant(fakeAcl($write), false, true), 'not designated');
    same(LaunchGrant::ReadOnly, LaunchTokenMinter::grant(fakeAcl($write), true, false), 'not on the write allowlist');
    same(LaunchGrant::ReadOnly, LaunchTokenMinter::grant(fakeAcl($read), true, true), 'no docs write');
    same(LaunchGrant::ReadAndUpload, LaunchTokenMinter::grant(fakeAcl($write), true, true), 'designated, write acl, write allowlist');
    same(LaunchGrant::None, LaunchTokenMinter::grant(fakeAcl(['patients/docs/write']), true, true), 'write without read');
});

check('launcher tokens: openemr-module / openemr-session claims, scope-matched acl, TTL under 300 s, Ed25519 shared vector', function () use ($patient, $launchSigningKey, $launchVerifyKey, $launchVectors): void {
    $minter = new LaunchTokenMinter($launchSigningKey);
    $verifier = new ContextTokenVerifier('unrelated-demo-secret', $launchVerifyKey);
    $read = $verifier->verify($minter->mint($patient, LAUNCH_VECTOR_CLINICIAN, LaunchScope::ReadBriefing, LAUNCH_VECTOR_NOW), LAUNCH_VECTOR_NOW);
    same(['openemr-module', 'openemr-session', 'read-briefing', 'read', $patient, LAUNCH_VECTOR_CLINICIAN], [$read->issuer, $read->authn, $read->scope, $read->acl, $read->patientUuid, $read->clinicianUuid], 'read token');
    $write = $verifier->verify($minter->mint(strtoupper($patient), LAUNCH_VECTOR_CLINICIAN, LaunchScope::WriteSourceDocument, LAUNCH_VECTOR_NOW), LAUNCH_VECTOR_NOW);
    same(['openemr-module', 'openemr-session', 'write-source-document', 'write', $patient], [$write->issuer, $write->authn, $write->scope, $write->acl, $write->patientUuid], 'write token');
    same(true, $write->expiresAt > LAUNCH_VECTOR_NOW && $write->expiresAt <= LAUNCH_VECTOR_NOW + ContextTokenVerifier::MAX_TTL_SECONDS, 'ttl');
    same($launchVectors['write_token'], $minter->mint($patient, LAUNCH_VECTOR_CLINICIAN, LaunchScope::WriteSourceDocument, LAUNCH_VECTOR_NOW), 'shared vector');
});

check('launcher tokens: an openemr-module token HMAC-signed with AGENTFORGE_DEMO_SECRET is context_invalid (a demo-secret holder cannot forge a launch)', function () use ($secret, $launchVerifyKey, $launchVectors): void {
    // The forged vector is HMAC-signed with $secret, the very secret this verifier holds.
    throwsApiError(fn() => (new ContextTokenVerifier($secret, $launchVerifyKey))->verify($launchVectors['hmac_forged_write_token'], LAUNCH_VECTOR_NOW), 401, 'context_invalid');
    throwsApiError(fn() => (new ContextTokenVerifier($secret))->verify($launchVectors['hmac_forged_write_token'], LAUNCH_VECTOR_NOW), 401, 'context_invalid');
});

check('launcher tokens: tampered, other-key, keyless and non-canonical tokens are context_invalid', function () use ($patient, $launchSigningKey, $launchVerifyKey): void {
    $token = (new LaunchTokenMinter($launchSigningKey))->mint($patient, LAUNCH_VECTOR_CLINICIAN, LaunchScope::ReadBriefing, LAUNCH_VECTOR_NOW);
    [$encoded, $signature] = explode('.', $token);
    $forged = HmacVerifier::base64UrlEncode(str_replace('read-briefing', 'write-source-document', (string) base64_decode(strtr($encoded, '-_', '+/'))));
    $verifier = new ContextTokenVerifier('unrelated-demo-secret', $launchVerifyKey);
    throwsApiError(fn() => $verifier->verify($forged . '.' . $signature, LAUNCH_VECTOR_NOW), 401, 'context_invalid');
    $otherKey = LaunchSigningKey::fromBase64Seed(base64_encode(str_repeat("\x01", 32)));
    throwsApiError(fn() => (new ContextTokenVerifier('unrelated-demo-secret', $otherKey->verifyKey))->verify($token, LAUNCH_VECTOR_NOW), 401, 'context_invalid');
    throwsApiError(fn() => (new ContextTokenVerifier('unrelated-demo-secret'))->verify($token, LAUNCH_VECTOR_NOW), 401, 'context_invalid');
    // The last base64url character carries 4 unused bits: a twin string decodes to the same signature.
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    $twin = substr($signature, 0, -1) . $alphabet[strpos($alphabet, substr($signature, -1)) ^ 1];
    throwsApiError(fn() => $verifier->verify($encoded . '.' . $twin, LAUNCH_VECTOR_NOW), 401, 'context_invalid');
});

check('launcher tokens: each issuer has one scheme, so a synthetic-demo claim signed with the launch key is refused', function () use ($launchSigningKey, $launchVerifyKey): void {
    $encoded = HmacVerifier::base64UrlEncode(json_encode(['patient_uuid' => 'p', 'clinician_uuid' => 'c', 'scope' => 'read-briefing', 'issuer' => 'synthetic-demo', 'authn' => 'synthetic', 'role' => 'clinician', 'acl' => 'read', 'expires_at' => LAUNCH_VECTOR_NOW + 100], JSON_THROW_ON_ERROR));
    $token = $encoded . '.' . HmacVerifier::base64UrlEncode($launchSigningKey->sign($encoded));
    throwsApiError(fn() => (new ContextTokenVerifier('unrelated-demo-secret', $launchVerifyKey))->verify($token, LAUNCH_VECTOR_NOW), 401, 'context_invalid');
});

check('launch keys: malformed seeds or verify keys, and a mismatched pair, are refused', function () use ($launchVectors): void {
    foreach (['', 'not base64', base64_encode(str_repeat('a', 31)), rtrim($launchVectors['signing_key_base64'], '=')] as $bad) {
        try {
            LaunchSigningKey::fromBase64Seed($bad);
        } catch (InvalidArgumentException) {
            continue;
        }
        throw new RuntimeException("expected a malformed seed to be refused: $bad");
    }
    foreach (['', base64_encode(str_repeat('a', 33))] as $bad) {
        try {
            LaunchVerifyKey::fromBase64($bad);
        } catch (InvalidArgumentException) {
            continue;
        }
        throw new RuntimeException("expected a malformed verify key to be refused: $bad");
    }
    try {
        LaunchSigningKey::fromBase64Seed(base64_encode(str_repeat("\x01", 32)), $launchVectors['verify_key_base64']);
    } catch (InvalidArgumentException) {
        return;
    }
    throw new RuntimeException('expected a signing key that does not match the verify key to be refused');
});

check('launcher tokens: a numeric user id is refused (the module resolves the actor by users.uuid)', function () use ($patient, $launchSigningKey): void {
    $minter = new LaunchTokenMinter($launchSigningKey);
    foreach ([[$patient, '1'], ['17', LAUNCH_VECTOR_CLINICIAN]] as [$patientRef, $clinicianRef]) {
        try {
            $minter->mint($patientRef, $clinicianRef, LaunchScope::ReadBriefing, LAUNCH_VECTOR_NOW);
        } catch (InvalidArgumentException) {
            continue;
        }
        throw new RuntimeException("expected a non-uuid to be refused: $patientRef / $clinicianRef");
    }
});

check('launcher write token passes the module allowlist only for an allowlisted patient', function () use ($policy, $signedFor, $patient, $launchSigningKey, $launchVerifyKey): void {
    $minter = new LaunchTokenMinter($launchSigningKey);
    $verifier = new ContextTokenVerifier('unrelated-demo-secret', $launchVerifyKey);
    $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor($patient), $verifier->verify($minter->mint($patient, LAUNCH_VECTOR_CLINICIAN, LaunchScope::WriteSourceDocument, LAUNCH_VECTOR_NOW), LAUNCH_VECTOR_NOW));
    $other = '11111111-2222-4333-8444-555555555555';
    throwsApiError(fn() => $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor($other), $verifier->verify($minter->mint($other, LAUNCH_VECTOR_CLINICIAN, LaunchScope::WriteSourceDocument, LAUNCH_VECTOR_NOW), LAUNCH_VECTOR_NOW)), 403, 'demo_patient_not_allowed');
    throwsApiError(fn() => $policy->authorize(AccessPolicy::policyFor('POST', 'documents'), $signedFor($patient), $verifier->verify($minter->mint($patient, LAUNCH_VECTOR_CLINICIAN, LaunchScope::ReadBriefing, LAUNCH_VECTOR_NOW), LAUNCH_VECTOR_NOW)), 403, 'acl_denied');
});

check('launcher URL: read token always, write token only when granted, both URL-encoded', function (): void {
    same('https://example.test/agentforge-w2/?demo_token=a.b', LaunchTokenMinter::launchUrl('https://example.test/agentforge-w2/', 'a.b', null));
    same('https://example.test/agentforge-w2/?demo_token=a.b&write_token=c%2Bd', LaunchTokenMinter::launchUrl('https://example.test/agentforge-w2', 'a.b', 'c+d'));
});

foreach ($vectors['idempotency_key_vectors'] as $vector) {
    check("idempotency key vector {$vector['kind']}", function () use ($vector): void {
        $key = match ($vector['kind']) {
            'document' => IdempotencyKey::forDocument($vector['pid'], DocumentType::from($vector['document_type']), $vector['content_sha256']),
            'derived_facts' => IdempotencyKey::forDerivedFacts($vector['pid'], $vector['source_document_id'], $vector['content_sha256']),
            'lab_results' => IdempotencyKey::forLabResults($vector['pid'], $vector['source_sha256']),
            'list_item' => IdempotencyKey::forListItem($vector['pid'], ListItemKind::from($vector['list_kind']), $vector['source_document_id'], $vector['title']),
        };
        same($vector['expected'], $key->value);
    });
}

check('idempotency key: same file, same patient, same key; other patient differs', function (): void {
    $sha = hash('sha256', 'x');
    same(IdempotencyKey::forDocument(1, DocumentType::LabPdf, $sha)->value, IdempotencyKey::forDocument(1, DocumentType::LabPdf, $sha)->value);
    if (IdempotencyKey::forDocument(2, DocumentType::LabPdf, $sha)->value === IdempotencyKey::forDocument(1, DocumentType::LabPdf, $sha)->value) {
        throw new RuntimeException('keys must be patient-scoped');
    }
});

$actor = new Actor(1, 'admin', 'synthetic-demo');

check('idempotent writer: second call returns the first response and writes nothing', function () use ($actor): void {
    $ledger = new InMemoryLedger();
    $audit = new RecordingAudit();
    $writer = new IdempotentWriter($ledger, $audit);
    $writes = 0;
    $write = function () use (&$writes): WriteOutcome {
        $writes++;
        return new WriteOutcome(['document_id' => 56 + $writes], 56 + $writes, null, 1);
    };
    $key = IdempotencyKey::forDocument(1, DocumentType::LabPdf, hash('sha256', 'pdf'));
    $first = $writer->execute($key, 'doc:lab_pdf', 1, hash('sha256', 'pdf'), 'payload-a', $actor, $write);
    $second = $writer->execute($key, 'doc:lab_pdf', 1, hash('sha256', 'pdf'), 'payload-a', $actor, $write);
    same(true, $first->created);
    same(false, $second->created);
    same(1, $writes, 'writer calls');
    same(1, count($ledger->rows), 'ledger rows');
    same(57, $second->response['document_id'], 'duplicate returns the first id');
    same($key->value, $second->response['idempotency_key']);
    same('duplicate', $second->body()['status']);
    same(200, $second->httpStatus());
    same(201, $first->httpStatus());
    same(1, count($audit->events), 'audit events');
    same(false, array_key_exists('payload_differs', $second->body()), 'no payload_differs flag: a differing payload is a 409');
    same(['acquire:' . $key->value, 'release:' . $key->value, 'acquire:' . $key->value, 'release:' . $key->value], $ledger->locks);
});

check('idempotent writer: a differing payload on a known key is a 409 idempotency_conflict, never a 200 duplicate, and writes nothing', function () use ($actor): void {
    $ledger = new InMemoryLedger();
    $audit = new RecordingAudit();
    $writer = new IdempotentWriter($ledger, $audit);
    $key = IdempotencyKey::forLabResults(1, hash('sha256', 'pdf'));
    $writer->execute($key, 'lab', 1, null, 'payload-a', $actor, fn() => new WriteOutcome(['procedure_order_id' => 9], 57, 9, 4));
    throwsApiError(fn() => $writer->execute($key, 'lab', 1, null, 'payload-b', $actor, fn() => throw new LogicException('must not write')), 409, 'idempotency_conflict');
    throwsApiError(fn() => $writer->assertNoConflict($key, 'payload-b'), 409, 'idempotency_conflict');
    $writer->assertNoConflict($key, 'payload-a');
    same(1, count($ledger->rows), 'ledger rows');
    same(1, count($audit->events), 'audit events');
    same('release:' . $key->value, end($ledger->locks), 'lock released after the conflict');
});

check('idempotency key: derived facts are content-addressed, so a re-extraction with other facts gets its own key', function (): void {
    $a = IdempotencyKey::forDerivedFacts(1, 57, hash('sha256', '{"facts":"a"}'));
    same($a->value, IdempotencyKey::forDerivedFacts(1, 57, hash('sha256', '{"facts":"a"}'))->value);
    if ($a->value === IdempotencyKey::forDerivedFacts(1, 57, hash('sha256', '{"facts":"b"}'))->value) {
        throw new RuntimeException('different derived content must not share a key');
    }
});

check('idempotent writer: a failed write leaves no ledger row and releases the lock', function () use ($actor): void {
    $ledger = new InMemoryLedger();
    $writer = new IdempotentWriter($ledger, new RecordingAudit());
    $key = IdempotencyKey::forLabResults(1, hash('sha256', 'pdf'));
    try {
        $writer->execute($key, 'lab', 1, null, 'p', $actor, fn() => throw new RuntimeException('insert failed'));
    } catch (RuntimeException) {
    }
    same([], $ledger->rows);
    same('release:' . $key->value, end($ledger->locks));
});

$labBody = [
    'patient_uuid' => $patient,
    'source_document_id' => 57,
    'source_sha256' => hash('sha256', 'pdf'),
    'results' => [
        ['field_id' => 'lab.hgb', 'loinc_code' => '718-7', 'test_name' => 'Hemoglobin', 'value' => '13.2', 'unit' => 'g/dL', 'reference_range' => '12.0-16.0', 'abnormal' => 'no', 'collection_date' => '2026-09-20', 'page' => 1],
        ['field_id' => 'lab.a1c', 'loinc_code' => '4548-4', 'test_name' => 'A1C', 'value' => '6.1', 'unit' => '%', 'reference_range' => 'under 5.7', 'abnormal' => 'yes', 'collection_date' => '2026-09-20', 'page' => 1],
    ],
];

check('lab row plan satisfies the 8.0.0 FHIR laboratory search join', function () use ($labBody, $actor): void {
    $plan = LabRowPlanner::plan(1, LabResultsRequest::fromBody($labBody), $actor);
    same($plan['code']['procedure_order_seq'], $plan['report']['procedure_order_seq'], 'code seq == report seq');
    same(1, $plan['order']['activity']);
    same(0, $plan['order']['provider_id']);
    same('AF1:' . hash('sha256', 'pdf'), $plan['order']['control_id']);
    same('prelim', $plan['report']['report_status'], 'unreviewed extraction is preliminary');
    same('prelim', $plan['results'][0]['result_status']);
    same('prelim', $plan['results'][1]['result_status']);
    same('received', $plan['report']['review_status']);
    same('2026-09-20 00:00:00', $plan['report']['date_report']);
    same(2, count($plan['results']));
    same('718-7', $plan['results'][0]['result_code']);
    same('N', $plan['results'][0]['result_data_type']);
    same('under 5.7', $plan['results'][1]['range'], 'raw range is preserved');
    same('yes', $plan['results'][1]['abnormal']);
    same(57, $plan['results'][1]['document_id']);
    same('agentforge:v1 doc=57 page=1 field=lab.a1c', $plan['results'][1]['comments']);
});

check('lab results request rejects bad LOINC, date, abnormal flag and duplicates', function () use ($labBody): void {
    $bad = $labBody;
    $bad['results'][0]['loinc_code'] = '718';
    $bad['results'][1]['collection_date'] = '09/20/2026';
    $bad['results'][1]['abnormal'] = 'elevated';
    try {
        LabResultsRequest::fromBody($bad);
        throw new RuntimeException('expected invalid_request');
    } catch (ApiError $error) {
        same(['results[0].loinc_code_invalid', 'results[1].abnormal_invalid', 'results[1].collection_date_invalid'], $error->issues);
    }
    $dup = $labBody;
    $dup['results'][1]['field_id'] = 'lab.hgb';
    throwsApiError(fn() => LabResultsRequest::fromBody($dup), 400, 'invalid_request');
});

$pdf = "%PDF-1.4\nsynthetic\n";
$docBody = static fn(array $overrides = []): array => array_merge([
    'patient_uuid' => $patient,
    'document_type' => 'lab_pdf',
    'filename' => 'filled-lab-a.pdf',
    'mime_type' => 'application/pdf',
    'content_sha256' => hash('sha256', $pdf),
    'content_base64' => base64_encode($pdf),
], $overrides);

check('document request: a valid PDF parses; hashes and magic bytes are enforced', function () use ($docBody, $pdf): void {
    $request = DocumentWriteRequest::fromBody($docBody());
    same(DocumentType::LabPdf, $request->documentType);
    same($pdf, $request->content);
    throwsApiError(fn() => DocumentWriteRequest::fromBody($docBody(['content_sha256' => hash('sha256', 'other')])), 400, 'invalid_request');
    throwsApiError(fn() => DocumentWriteRequest::fromBody($docBody(['content_base64' => base64_encode('not a pdf'), 'content_sha256' => hash('sha256', 'not a pdf')])), 400, 'invalid_request');
    throwsApiError(fn() => DocumentWriteRequest::fromBody($docBody(['filename' => '../etc/passwd'])), 400, 'invalid_request');
    throwsApiError(fn() => DocumentWriteRequest::fromBody($docBody(['mime_type' => 'text/html'])), 400, 'invalid_request');
});

check('document request: derived facts must be a JSON object linked to a source', function () use ($docBody): void {
    $json = '{"schema":"agentforge-derived-facts-v1"}';
    $base = ['document_type' => 'derived_facts', 'filename' => 'derived.json', 'mime_type' => 'application/json', 'content_sha256' => hash('sha256', $json), 'content_base64' => base64_encode($json)];
    throwsApiError(fn() => DocumentWriteRequest::fromBody($docBody($base)), 400, 'invalid_request');
    same(57, DocumentWriteRequest::fromBody($docBody($base + ['source_document_id' => 57]))->sourceDocumentId);
    same(57, DocumentWriteRequest::fromBody($docBody(array_merge($base, ['source_document_id' => 57])))->sourceDocumentId);
    throwsApiError(fn() => DocumentWriteRequest::fromBody($docBody(['source_document_id' => 57])), 400, 'invalid_request');
});

check('document request: synthetic scan envelopes are accepted only as UTF-8 .txt', function () use ($docBody): void {
    $text = "SYNTHETIC_SCAN_FORM|layout=lab-a\n";
    $ok = ['mime_type' => 'text/plain', 'filename' => 'lab.scan.txt', 'content_sha256' => hash('sha256', $text), 'content_base64' => base64_encode($text)];
    same('text/plain', DocumentWriteRequest::fromBody($docBody($ok))->mimeType);
    throwsApiError(fn() => DocumentWriteRequest::fromBody($docBody(array_merge($ok, ['filename' => 'lab.html']))), 400, 'invalid_request');
});


// ---------------------------------------------------------------------------
// Dispatcher (AgentForgeApi) with the OpenEMR runtime stubbed: ACL, patient
// resolution, cross-patient document reads/links, allowlist and write scope.
// ---------------------------------------------------------------------------

final class FakeAcl implements AclChecker
{
    public bool $allow = true;
    /** @var list<string> */
    public array $checks = [];

    public function allows(string $section, string $value, string $username, bool $write): bool
    {
        $this->checks[] = "$section/$value/" . ($write ? 'write' : 'read');
        return $this->allow;
    }
}

final class FakeChart implements ChartGateway
{
    /** @var array<string, int> */
    public array $pids = [];
    public int $nextDocumentId = 57;
    /** @var list<string> */
    public array $writes = [];
    /** @var list<string> */
    public array $reads = [];

    public function pidFor(PatientUuid $patient): int
    {
        return $this->pids[$patient->value] ?? throw new ApiError(404, 'patient_not_found');
    }

    public function actorFor(ContextClaims $claims): Actor
    {
        return new Actor(1, 'admin', $claims->issuer);
    }

    public function categoryIdFor(DocumentType $type): int
    {
        return $type === DocumentType::LabPdf ? 2 : 3;
    }

    public function storeDocument(int $pid, int $categoryId, DocumentWriteRequest $request, Actor $actor): WriteOutcome
    {
        $id = $this->nextDocumentId++;
        $this->writes[] = "document:$pid:$id";
        return new WriteOutcome(['document_id' => $id, 'content_sha256' => $request->contentSha256, 'source_document_id' => $request->sourceDocumentId], $id, null, 1);
    }

    public function readDocument(int $pid, int $documentId, LedgerEntry $ledgerRow): array
    {
        $this->reads[] = "document:$pid:$documentId";
        return ['document_id' => $documentId];
    }

    public function storeLabResults(int $pid, LabResultsRequest $request, Actor $actor): WriteOutcome
    {
        $this->writes[] = "lab:$pid:{$request->sourceDocumentId}";
        return new WriteOutcome(['procedure_order_id' => 9, 'observation_ids' => ['o1']], $request->sourceDocumentId, 9, 4);
    }

    public function readLabObservations(PatientUuid $patient, LedgerEntry $labRow): array
    {
        $this->reads[] = 'observations:' . $patient->value;
        return ['resourceType' => 'Bundle'];
    }

    public function readLabObservationHistory(PatientUuid $patient, array $labRows): array
    {
        $this->reads[] = 'history:' . $patient->value . ':' . implode(',', array_map(static fn(LedgerEntry $row): string => $row->pid . '/' . $row->documentId, $labRows));
        return ['resourceType' => 'Bundle', 'scope' => LabHistoryAssembler::SCOPE];
    }

    public function storeListItem(int $pid, ListItemKind $kind, string $title, int $sourceDocumentId, string $confirmationEventId, Actor $actor): WriteOutcome
    {
        $this->writes[] = "list:$pid:{$kind->value}";
        return new WriteOutcome(['kind' => $kind->value, 'list_id' => 31], $sourceDocumentId, null, 1);
    }
}

const TEST_HMAC_SECRET = 'module-hmac-secret-for-tests';
const TEST_CONTEXT_SECRET = 'demo-context-secret-for-tests';
const PATIENT_A = 'a2c37f7f-1076-4172-b17a-bee8bb8d2da6';
const PATIENT_B = '11111111-2222-4333-8444-555555555555'; // another allowlisted synthetic patient
const PATIENT_C = '99999999-2222-4333-8444-555555555555'; // exists in OpenEMR, not allowlisted
const TEST_NOW = 1790000000;

/**
 * @return array{AgentForgeApi, InMemoryLedger, FakeChart, FakeAcl, RecordingAudit}
 */
function makeApi(bool $withLaunchKey = true): array
{
    global $launchVerifyKey;
    $ledger = new InMemoryLedger();
    $chart = new FakeChart();
    $chart->pids = [PATIENT_A => 1, PATIENT_B => 2, PATIENT_C => 3];
    $acl = new FakeAcl();
    $audit = new RecordingAudit();
    $api = new AgentForgeApi(
        new RequestAuthenticator(new HmacVerifier(TEST_HMAC_SECRET), new InMemoryNonceStore()),
        new ContextTokenVerifier(TEST_CONTEXT_SECRET, $withLaunchKey ? $launchVerifyKey : null),
        new AccessPolicy([PATIENT_A, PATIENT_B]),
        $ledger,
        new IdempotentWriter($ledger, $audit),
        $chart,
        $acl,
        $audit,
    );
    return [$api, $ledger, $chart, $acl, $audit];
}

/**
 * openemr-module tokens are Ed25519-signed with the test launch key, as the
 * launcher does; `$hmacLauncher` signs one with the demo secret instead (a forgery).
 */
function contextToken(string $patient, string $scope = 'write-source-document', string $issuer = 'synthetic-demo', string $secret = TEST_CONTEXT_SECRET, bool $hmacLauncher = false): string
{
    global $launchSigningKey;
    $payload = ['patient_uuid' => $patient, 'clinician_uuid' => 'a2c37ca7-696f-41cd-be17-ce0e5ae0a9a3', 'scope' => $scope, 'issuer' => $issuer, 'authn' => $issuer === 'openemr-module' ? 'openemr-session' : 'synthetic', 'role' => 'clinician', 'acl' => $scope === 'read-briefing' ? 'read' : 'write', 'expires_at' => TEST_NOW + 200];
    $encoded = HmacVerifier::base64UrlEncode(json_encode($payload, JSON_THROW_ON_ERROR));
    if ($issuer === ContextClaims::ISSUER_OPENEMR_MODULE && !$hmacLauncher) {
        return $encoded . '.' . HmacVerifier::base64UrlEncode($launchSigningKey->sign($encoded));
    }
    return $encoded . '.' . ContextTokenVerifier::sign($encoded, $secret);
}

/**
 * Signs and dispatches one request exactly as the Node client would.
 *
 * @param array<string, string>     $query
 * @param array<string, mixed>|null $body
 * @return array{int, array<string, mixed>}
 */
function call(AgentForgeApi $api, string $method, array $query, ?array $body, ?string $token, string $secret = TEST_HMAC_SECRET): array
{
    $query = ['site' => 'default'] + $query;
    $raw = $body === null ? '' : json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    $nonce = bin2hex(random_bytes(16));
    $canonical = new CanonicalRequest($method, $query['route'], 'default', $method === 'POST' ? (string) ($body['patient_uuid'] ?? '') : ($query['patient_uuid'] ?? ''), $method === 'POST' ? (string) ($body['content_sha256'] ?? '') : '', hash('sha256', $raw), (string) TEST_NOW, $nonce, $query, $token === null ? '' : hash('sha256', $token));
    $headers = ['x-agentforge-key-id' => 'v1', 'x-agentforge-timestamp' => (string) TEST_NOW, 'x-agentforge-nonce' => $nonce, 'x-agentforge-content-sha256' => hash('sha256', $raw), 'x-agentforge-signature' => (new HmacVerifier($secret))->sign($canonical)];
    if ($token !== null) {
        $headers['x-agentforge-context-token'] = $token;
    }
    try {
        return $api->handle($method, $query, $headers, $raw, TEST_NOW);
    } catch (ApiError $error) {
        return [$error->httpStatus, $error->toBody()];
    }
}

/**
 * @return array<string, mixed>
 */
function pdfBody(string $patient, string $bytes = "%PDF-1.4\nsynthetic\n"): array
{
    return ['patient_uuid' => $patient, 'document_type' => 'lab_pdf', 'filename' => 'filled-lab-a.pdf', 'mime_type' => 'application/pdf', 'content_sha256' => hash('sha256', $bytes), 'content_base64' => base64_encode($bytes)];
}

/**
 * @return array<string, mixed>
 */
function derivedBody(string $patient, int $sourceId): array
{
    $json = '{"schema":"agentforge-derived-facts-v1"}';
    return ['patient_uuid' => $patient, 'document_type' => 'derived_facts', 'filename' => 'derived.json', 'mime_type' => 'application/json', 'content_sha256' => hash('sha256', $json), 'content_base64' => base64_encode($json), 'source_document_id' => $sourceId];
}

check('dispatcher: store is idempotent and ACL-checked with write rights', function (): void {
    [$api, , $chart, $acl] = makeApi();
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A));
    same([201, 57], [$status, $body['document_id']]);
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A));
    same([200, 'duplicate', 57], [$status, $body['status'], $body['document_id']]);
    same(['document:1:57'], $chart->writes, 'one write');
    same(['patients/docs/write', 'patients/docs/write'], $acl->checks);
});

// F-OBS: agentforge-w2's /ready probes this route (openemr-module persistence).
check('dispatcher: health answers ok to a signed request with no context token, and touches no chart data', function (): void {
    [$api, , $chart, $acl] = makeApi();
    [$status, $body] = call($api, 'GET', ['route' => 'health'], null, null);
    same([200, 'ok', 'openemr-module'], [$status, $body['status'], $body['persistence_boundary']]);
    same([[], [], []], [$chart->writes, $chart->reads, $acl->checks]);
    [$status, $body] = call($api, 'GET', ['route' => 'health'], null, null, 'wrong-hmac-secret');
    same([401, 'signature_invalid'], [$status, $body['error']]);
});

check('dispatcher: ACL denial blocks the write and the read (requireAcl is enforced)', function (): void {
    [$api, , $chart, $acl] = makeApi();
    $acl->allow = false;
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A));
    same([403, 'acl_denied'], [$status, $body['error']]);
    same([], $chart->writes);
    same(403, call($api, 'GET', ['route' => 'documents', 'patient_uuid' => PATIENT_A, 'document_id' => '57'], null, contextToken(PATIENT_A))[0]);
    same([], $chart->reads);
});

check('dispatcher: a read-scope token cannot write', function (): void {
    [$api, , $chart] = makeApi();
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A, 'read-briefing'));
    same([403, 'acl_denied'], [$status, $body['error']]);
    same([], $chart->writes);
});

check("dispatcher: another patient's document is never read, even if the lookup ignores the patient", function (): void {
    [$api, $ledger, $chart] = makeApi();
    same(201, call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_B), contextToken(PATIENT_B))[0]);
    $ledger->ignorePid = true;
    [$status, $body] = call($api, 'GET', ['route' => 'documents', 'patient_uuid' => PATIENT_A, 'document_id' => '57'], null, contextToken(PATIENT_A));
    same([404, 'document_not_found'], [$status, $body['error']]);
    same([], $chart->reads);
});

check("dispatcher: derived facts cannot link to another patient's source", function (): void {
    [$api, $ledger, $chart] = makeApi();
    same(201, call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_B), contextToken(PATIENT_B))[0]);
    foreach ([false, true] as $ignorePid) {
        $ledger->ignorePid = $ignorePid;
        [$status, $body] = call($api, 'POST', ['route' => 'documents'], derivedBody(PATIENT_A, 57), contextToken(PATIENT_A));
        same([404, 'document_not_found'], [$status, $body['error']], $ignorePid ? 'leaky lookup' : 'normal lookup');
    }
    same(['document:2:57'], $chart->writes);
    $ledger->ignorePid = false;
    same(201, call($api, 'POST', ['route' => 'documents'], derivedBody(PATIENT_B, 57), contextToken(PATIENT_B))[0]);
});

check("dispatcher: lab rows need this patient's lab source with the same hash", function (): void {
    [$api, $ledger, $chart] = makeApi();
    $bytes = "%PDF-1.4\nsynthetic\n";
    call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_B, $bytes), contextToken(PATIENT_B));
    $lab = ['patient_uuid' => PATIENT_A, 'source_document_id' => 57, 'source_sha256' => hash('sha256', $bytes), 'results' => [['field_id' => 'lab.hgb', 'loinc_code' => '718-7', 'test_name' => 'Hemoglobin', 'value' => '13.2', 'unit' => 'g/dL', 'reference_range' => '12.0-16.0', 'abnormal' => 'no', 'collection_date' => '2026-09-20', 'page' => 1]]];
    $ledger->ignorePid = true;
    same(404, call($api, 'POST', ['route' => 'lab-results'], $lab, contextToken(PATIENT_A))[0]);
    $ledger->ignorePid = false;
    same(201, call($api, 'POST', ['route' => 'lab-results'], ['patient_uuid' => PATIENT_B] + $lab, contextToken(PATIENT_B))[0]);
    same(400, call($api, 'POST', ['route' => 'lab-results'], ['patient_uuid' => PATIENT_B, 'source_sha256' => str_repeat('0', 64)] + $lab, contextToken(PATIENT_B))[0]);
    same(['document:2:57', 'lab:2:57'], $chart->writes);
});

check('dispatcher: the allowlist binds every issuer, including openemr-module', function (): void {
    [$api, , $chart] = makeApi();
    foreach (['synthetic-demo', 'openemr-module'] as $issuer) {
        [$status, $body] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_C), contextToken(PATIENT_C, 'write-source-document', $issuer));
        same([403, 'demo_patient_not_allowed'], [$status, $body['error']], $issuer);
    }
    same([], $chart->writes);
});

check('dispatcher: request signatures and context tokens use separate secrets', function (): void {
    [$api, , $chart] = makeApi();
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A), TEST_CONTEXT_SECRET);
    same([401, 'signature_invalid'], [$status, $body['error']]);
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A, 'write-source-document', 'synthetic-demo', TEST_HMAC_SECRET));
    same([401, 'context_invalid'], [$status, $body['error']]);
    same([], $chart->writes);
});

// ---------------------------------------------------------------------------
// W3 H1: module trust (launcher key, list provenance, read audit, 409 conflicts).
// ---------------------------------------------------------------------------

check('dispatcher: an openemr-module token HMAC-signed with the demo secret is refused; the Ed25519 launcher token writes', function (): void {
    [$api, , $chart, , $audit] = makeApi();
    // Signed with TEST_CONTEXT_SECRET, the demo secret this API itself verifies synthetic tokens with.
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A, 'write-source-document', 'openemr-module', TEST_CONTEXT_SECRET, true));
    same([401, 'context_invalid'], [$status, $body['error']]);
    same([], $chart->writes, 'the forged launcher token wrote nothing');
    same([], $audit->events);
    [$status] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A, 'write-source-document', 'openemr-module'));
    same(201, $status);
    same(['doc:lab_pdf:1:57:1:openemr-module'], $audit->events, 'attributed to the launcher issuer');
});

check('dispatcher: without AGENTFORGE_LAUNCH_VERIFY_KEY every launcher token is refused and synthetic-demo writes are unchanged', function (): void {
    [$api, , $chart] = makeApi(false);
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A, 'write-source-document', 'openemr-module'));
    same([401, 'context_invalid', ['launch_verify_key_not_configured']], [$status, $body['error'], $body['issues'] ?? []]);
    same(201, call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A))[0]);
    same(['document:1:57'], $chart->writes);
});

check('list provenance: only an openemr-module actor is recorded as clinician-confirmed; a synthetic-demo row is labeled and unconfirmed', function (): void {
    // allergyintolerance-verification option ids (sql/database.sql).
    $verificationOptions = ['unconfirmed', 'confirmed', 'refuted', 'entered-in-error'];
    $session = ClinicalListWriter::listRow(ListItemKind::Allergy, 58, 'confirm-1', new Actor(7, 'clinician', 'openemr-module'));
    same(['allergy', 'AgentForge intake doc 58; clinician-confirmed confirm-1', 'confirmed'], [$session['type'], $session['comments'], $session['verification']]);
    $demo = ClinicalListWriter::listRow(ListItemKind::Allergy, 58, 'confirm-1', new Actor(1, 'demo-actor', 'synthetic-demo'));
    same('unconfirmed', $demo['verification']);
    same(true, in_array($demo['verification'], $verificationOptions, true) && in_array($session['verification'], $verificationOptions, true), 'valid list options');
    same(false, str_contains($demo['comments'], '; clinician-confirmed'), 'a demo row never claims clinician confirmation');
    same(true, str_contains($demo['comments'], 'unauthenticated synthetic-demo'), 'a demo row names its provenance');
    $demoMedication = ClinicalListWriter::listRow(ListItemKind::Medication, 58, 'confirm-1', new Actor(1, 'demo-actor', 'synthetic-demo'));
    same(['medication', ''], [$demoMedication['type'], $demoMedication['verification']]);
    same(false, str_contains($demoMedication['comments'], '; clinician-confirmed'));
    same(ListItemProvenance::UnauthenticatedSyntheticDemo, ListItemProvenance::forActor(new Actor(1, 'demo-actor', 'synthetic-demo')));
    try {
        ListItemProvenance::forActor(new Actor(1, 'x', 'somebody-else'));
    } catch (DomainException) {
        return;
    }
    throw new RuntimeException('an unknown issuer must not be given a provenance');
});

check('read audit: document and lab-observation reads are audited with codes and ids only; refused reads are not', function (): void {
    [$api, , , , $audit] = makeApi();
    $id = storeLab($api, PATIENT_A, "%PDF-1.4\nlab one\n");
    $audit->reads = [];
    same(200, call($api, 'GET', ['route' => 'documents', 'patient_uuid' => PATIENT_A, 'document_id' => (string) $id], null, contextToken(PATIENT_A, 'read-briefing'))[0]);
    same(200, call($api, 'GET', ['route' => 'lab-observations', 'patient_uuid' => PATIENT_A, 'source_document_id' => (string) $id], null, contextToken(PATIENT_A, 'read-briefing'))[0]);
    same(200, call($api, 'GET', ['route' => 'lab-observations', 'patient_uuid' => PATIENT_A], null, contextToken(PATIENT_A, 'read-briefing'))[0]);
    same(["doc:lab_pdf:1:$id:1:synthetic-demo", "lab:1:$id:0:synthetic-demo", 'lab-history:1:-:0:synthetic-demo'], $audit->reads);
    same(404, call($api, 'GET', ['route' => 'documents', 'patient_uuid' => PATIENT_A, 'document_id' => '999'], null, contextToken(PATIENT_A, 'read-briefing'))[0]);
    same(3, count($audit->reads), 'a refused read records nothing');
});

check('dispatcher: lab rows re-sent for the same source with other values are a 409 conflict, not a duplicate', function (): void {
    [$api, , $chart] = makeApi();
    $id = storeLab($api, PATIENT_A, "%PDF-1.4\nlab one\n");
    $lab = ['patient_uuid' => PATIENT_A, 'source_document_id' => $id, 'source_sha256' => hash('sha256', "%PDF-1.4\nlab one\n"), 'results' => [['field_id' => 'lab.hgb', 'loinc_code' => '718-7', 'test_name' => 'Hemoglobin', 'value' => '9.9', 'unit' => 'g/dL', 'reference_range' => '12.0-16.0', 'abnormal' => 'low', 'collection_date' => '2026-09-20', 'page' => 1]]];
    [$status, $body] = call($api, 'POST', ['route' => 'lab-results'], $lab, contextToken(PATIENT_A));
    same([409, 'idempotency_conflict', ['payload_differs']], [$status, $body['error'], $body['issues'] ?? []]);
    same(['document:1:57', 'lab:1:57'], $chart->writes, 'nothing new written');
});

check('dispatcher: a re-extraction with different derived facts is stored as its own derived-facts document (content-addressed key)', function (): void {
    [$api, , $chart] = makeApi();
    same(201, call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A))[0]);
    $derived = static function (string $json): array {
        return ['patient_uuid' => PATIENT_A, 'document_type' => 'derived_facts', 'filename' => 'agentforge-derived-facts-57.json', 'mime_type' => 'application/json', 'content_sha256' => hash('sha256', $json), 'content_base64' => base64_encode($json), 'source_document_id' => 57];
    };
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], $derived('{"facts":"a"}'), contextToken(PATIENT_A));
    same([201, 58], [$status, $body['document_id']]);
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], $derived('{"facts":"a"}'), contextToken(PATIENT_A));
    same([200, 'duplicate', 58], [$status, $body['status'], $body['document_id']]);
    [$status, $body] = call($api, 'POST', ['route' => 'documents'], $derived('{"facts":"b"}'), contextToken(PATIENT_A));
    same([201, 59], [$status, $body['document_id']]);
    same(['document:1:57', 'document:1:58', 'document:1:59'], $chart->writes);
});

check('dispatcher: a list item whose key exists with another body is refused before any item of the request is written', function (): void {
    [$api, , $chart] = makeApi();
    call($api, 'POST', ['route' => 'documents'], medlistBody(PATIENT_A), contextToken(PATIENT_A));
    $metformin = ['kind' => 'medication', 'title' => 'Metformin 500 mg twice daily oral', 'field_id' => 'medication.1'];
    same(201, call($api, 'POST', ['route' => 'clinical-list-items'], listItemsBody(PATIENT_A, 57, [$metformin]), contextToken(PATIENT_A, 'write-clinical-action'))[0]);
    $lisinopril = ['kind' => 'medication', 'title' => 'Lisinopril 10 mg daily oral', 'field_id' => 'medication.2'];
    [$status, $body] = call($api, 'POST', ['route' => 'clinical-list-items'], listItemsBody(PATIENT_A, 57, [$lisinopril, ['field_id' => 'medication.3'] + $metformin]), contextToken(PATIENT_A, 'write-clinical-action'));
    same([409, 'idempotency_conflict'], [$status, $body['error']]);
    same(['document:1:57', 'list:1:medication'], $chart->writes, 'lisinopril was not written either');
    [$status, $body] = call($api, 'POST', ['route' => 'clinical-list-items'], listItemsBody(PATIENT_A, 57, [$lisinopril, ['field_id' => 'medication.3', 'title' => 'LISINOPRIL 10 mg daily oral'] + $lisinopril]), contextToken(PATIENT_A, 'write-clinical-action'));
    same([400, ['items[1].duplicate_title']], [$status, $body['issues'] ?? []]);
});
// ---------------------------------------------------------------------------
// E4: medication_list, the third source document type. Stored like the
// other sources; its medications reach the chart only through the
// confirm-only clinical-list-items route (A3), and only as medications.
// ---------------------------------------------------------------------------

check('document type: medication_list is a source type stored as a Medical Record PDF or scan envelope', function () use ($docBody): void {
    same(DocumentType::MedicationList, DocumentType::from('medication_list'));
    same('Medical Record', DocumentType::MedicationList->categoryName());
    same(['application/pdf', 'text/plain'], DocumentType::MedicationList->allowedMimeTypes());
    same('doc:medication_list', DocumentType::MedicationList->ledgerOperation());
    same([DocumentType::LabPdf, DocumentType::IntakeForm, DocumentType::MedicationList], DocumentType::sourceTypes());
    same([ListItemKind::Medication], DocumentType::MedicationList->confirmableListItemKinds());
    same([ListItemKind::Medication, ListItemKind::Allergy], DocumentType::IntakeForm->confirmableListItemKinds());
    same([], DocumentType::LabPdf->confirmableListItemKinds());
    $request = DocumentWriteRequest::fromBody($docBody(['document_type' => 'medication_list', 'filename' => 'filled-medlist-a.pdf']));
    same(DocumentType::MedicationList, $request->documentType);
    throwsApiError(fn() => DocumentWriteRequest::fromBody($docBody(['document_type' => 'medication_list', 'mime_type' => 'application/json'])), 400, 'invalid_request');
});

/**
 * @return array<string, mixed>
 */
function medlistBody(string $patient, string $bytes = "%PDF-1.4\nsynthetic medication list\n"): array
{
    return ['document_type' => 'medication_list', 'filename' => 'filled-medlist-a.pdf'] + pdfBody($patient, $bytes);
}

/**
 * @param list<array{kind: string, title: string, field_id: string}> $items
 * @return array<string, mixed>
 */
function listItemsBody(string $patient, int $sourceId, array $items): array
{
    return ['patient_uuid' => $patient, 'source_document_id' => $sourceId, 'confirmation_event_id' => 'confirm-medlist-1', 'items' => $items];
}

check('dispatcher: a medication list and its derived facts are stored idempotently (a re-upload returns the same ids)', function (): void {
    [$api, , $chart] = makeApi();
    [$status, $source] = call($api, 'POST', ['route' => 'documents'], medlistBody(PATIENT_A), contextToken(PATIENT_A));
    same([201, 57], [$status, $source['document_id']]);
    [$status, $again] = call($api, 'POST', ['route' => 'documents'], medlistBody(PATIENT_A), contextToken(PATIENT_A));
    same([200, 'duplicate', 57], [$status, $again['status'], $again['document_id']]);
    [$status, $derived] = call($api, 'POST', ['route' => 'documents'], derivedBody(PATIENT_A, 57), contextToken(PATIENT_A));
    same([201, 58], [$status, $derived['document_id']]);
    [$status, $derivedAgain] = call($api, 'POST', ['route' => 'documents'], derivedBody(PATIENT_A, 57), contextToken(PATIENT_A));
    same([200, 58], [$status, $derivedAgain['document_id']]);
    same(['document:1:57', 'document:1:58'], $chart->writes, 'two writes, no list items');
    same([200, 57], [call($api, 'GET', ['route' => 'documents', 'patient_uuid' => PATIENT_A, 'document_id' => '57'], null, contextToken(PATIENT_A))[0], 57]);
});

check('dispatcher: medication-list items reach the chart only through the confirm route (write-clinical-action), and only as medications', function (): void {
    [$api, , $chart] = makeApi();
    call($api, 'POST', ['route' => 'documents'], medlistBody(PATIENT_A), contextToken(PATIENT_A));
    $medication = ['kind' => 'medication', 'title' => 'Metformin 500 mg twice daily oral', 'field_id' => 'medication.1'];
    // A source-document token cannot write list items; the confirm lane needs write-clinical-action.
    same(403, call($api, 'POST', ['route' => 'clinical-list-items'], listItemsBody(PATIENT_A, 57, [$medication]), contextToken(PATIENT_A))[0]);
    // A medication list never yields an allergy entry.
    [$status, $body] = call($api, 'POST', ['route' => 'clinical-list-items'], listItemsBody(PATIENT_A, 57, [$medication, ['kind' => 'allergy', 'title' => 'Penicillin', 'field_id' => 'allergy.1']]), contextToken(PATIENT_A, 'write-clinical-action'));
    same([400, 'invalid_request'], [$status, $body['error']]);
    same(['document:1:57'], $chart->writes, 'nothing reached the chart');
    [$status, $body] = call($api, 'POST', ['route' => 'clinical-list-items'], listItemsBody(PATIENT_A, 57, [$medication]), contextToken(PATIENT_A, 'write-clinical-action'));
    same([201, 'created'], [$status, $body['status']]);
    [$status, $body] = call($api, 'POST', ['route' => 'clinical-list-items'], listItemsBody(PATIENT_A, 57, [$medication]), contextToken(PATIENT_A, 'write-clinical-action'));
    same([200, 'duplicate'], [$status, $body['status']]);
    same(['document:1:57', 'list:1:medication'], $chart->writes);
});

check('dispatcher: a lab report is not a list-item source', function (): void {
    [$api, , $chart] = makeApi();
    call($api, 'POST', ['route' => 'documents'], pdfBody(PATIENT_A), contextToken(PATIENT_A));
    [$status, $body] = call($api, 'POST', ['route' => 'clinical-list-items'], listItemsBody(PATIENT_A, 57, [['kind' => 'medication', 'title' => 'Metformin', 'field_id' => 'medication.1']]), contextToken(PATIENT_A, 'write-clinical-action'));
    same([404, 'document_not_found'], [$status, $body['error']]);
    same(['document:1:57'], $chart->writes);
});

// ---------------------------------------------------------------------------
// E5 lab history (GET lab-observations without source_document_id).
// ---------------------------------------------------------------------------

/**
 * Stores a lab PDF and its lab rows for $patient through the dispatcher.
 *
 * @return int the stored document id
 */
function storeLab(AgentForgeApi $api, string $patient, string $bytes): int
{
    [, $doc] = call($api, 'POST', ['route' => 'documents'], pdfBody($patient, $bytes), contextToken($patient));
    $id = $doc['document_id'];
    $lab = ['patient_uuid' => $patient, 'source_document_id' => $id, 'source_sha256' => hash('sha256', $bytes), 'results' => [['field_id' => 'lab.hgb', 'loinc_code' => '718-7', 'test_name' => 'Hemoglobin', 'value' => '13.2', 'unit' => 'g/dL', 'reference_range' => '12.0-16.0', 'abnormal' => 'no', 'collection_date' => '2026-09-20', 'page' => 1]]];
    same(201, call($api, 'POST', ['route' => 'lab-results'], $lab, contextToken($patient))[0], 'lab rows stored');
    return $id;
}

/**
 * @return list<string>
 */
function historyReads(FakeChart $chart): array
{
    return array_values(array_filter($chart->reads, static fn(string $read): bool => str_starts_with($read, 'history:')));
}

check('lab history: no source_document_id reads every module lab row of this patient, read scope allowed', function (): void {
    [$api, , $chart, $acl] = makeApi();
    $first = storeLab($api, PATIENT_A, "%PDF-1.4\nlab one\n");
    $second = storeLab($api, PATIENT_A, "%PDF-1.4\nlab two\n");
    storeLab($api, PATIENT_B, "%PDF-1.4\nother patient\n");
    $acl->checks = [];
    [$status, $body] = call($api, 'GET', ['route' => 'lab-observations', 'patient_uuid' => PATIENT_A], null, contextToken(PATIENT_A, 'read-briefing'));
    same([200, LabHistoryAssembler::SCOPE], [$status, $body['scope']]);
    same(['history:' . PATIENT_A . ":1/$first,1/$second"], historyReads($chart));
    same(['patients/lab/read'], $acl->checks, 'lab read ACL is enforced');
});

check("lab history: never includes another patient's rows, even if the ledger lookup ignores the patient", function (): void {
    [$api, $ledger, $chart] = makeApi();
    storeLab($api, PATIENT_B, "%PDF-1.4\nother patient\n");
    $ledger->ignorePid = true;
    [$status, $body] = call($api, 'GET', ['route' => 'lab-observations', 'patient_uuid' => PATIENT_A], null, contextToken(PATIENT_A, 'read-briefing'));
    same([200, 1], [$status, $body['skipped_lab_rows']]);
    same(['history:' . PATIENT_A . ':'], historyReads($chart), 'leaky lookup yields no rows');
});

check('lab history: a lab row whose source is not a module-stored lab PDF is excluded', function (): void {
    [$api, $ledger, $chart] = makeApi();
    $stored = storeLab($api, PATIENT_A, "%PDF-1.4\nlab one\n");
    // A lab ledger row pointing at a document id the module never stored.
    $ledger->insert(new LedgerEntry('lab:v1:orphan', 'lab', 1, str_repeat('a', 64), 999, 5, ['observation_ids' => ['x']], str_repeat('b', 64), 1, 'synthetic-demo'));
    [, $body] = call($api, 'GET', ['route' => 'lab-observations', 'patient_uuid' => PATIENT_A], null, contextToken(PATIENT_A, 'read-briefing'));
    same(['history:' . PATIENT_A . ":1/$stored"], historyReads($chart));
    same(1, $body['skipped_lab_rows'], 'the dropped row is reported, not hidden');
});

check('lab history: patient scope, allowlist and a malformed source_document_id still refuse', function (): void {
    [$api, , $chart] = makeApi();
    storeLab($api, PATIENT_A, "%PDF-1.4\nlab one\n");
    [$status, $body] = call($api, 'GET', ['route' => 'lab-observations', 'patient_uuid' => PATIENT_A], null, contextToken(PATIENT_B, 'read-briefing'));
    same([403, 'patient_scope_mismatch'], [$status, $body['error']]);
    [$status, $body] = call($api, 'GET', ['route' => 'lab-observations', 'patient_uuid' => PATIENT_C], null, contextToken(PATIENT_C, 'read-briefing'));
    same([403, 'demo_patient_not_allowed'], [$status, $body['error']]);
    same(400, call($api, 'GET', ['route' => 'lab-observations', 'patient_uuid' => PATIENT_A, 'source_document_id' => '0'], null, contextToken(PATIENT_A, 'read-briefing'))[0]);
    same([], historyReads($chart));
});

check('lab history assembler: only ledger-recorded Observations, linked to their source document, local collection date', function (): void {
    $row = static fn(int $doc, array $ids): LedgerEntry => new LedgerEntry("lab:$doc", 'lab', 1, str_repeat('a', 64), $doc, 9, ['results' => array_map(static fn(string $id): array => ['field_id' => 'lab.a1c', 'observation_id' => $id], $ids), 'observation_ids' => $ids], str_repeat('b', 64), 1, 'synthetic-demo');
    $observation = static fn(string $id, int $doc, string $effective): array => ['resourceType' => 'Observation', 'id' => $id, 'effectiveDateTime' => $effective, 'note' => [['text' => "agentforge:v1 doc=$doc page=2 field=lab.a1c"]]];
    $bundle = LabHistoryAssembler::assemble(
        [$row(57, ['o1']), $row(60, ['o2', 'o3'])],
        [
            $observation('o1', 57, '2026-09-20T05:00:00+00:00'),
            $observation('chart-lab', 57, '2026-09-20T05:00:00+00:00'), // not written by this module
            $observation('o2', 61, '2026-06-18T05:00:00+00:00'),        // note names another document
        ],
        new DateTimeZone('America/Chicago'),
        'openemr-fhir-service-in-process',
    );
    same(1, $bundle['total']);
    same('o1', $bundle['entry'][0]['resource']['id']);
    same([57, 'lab.a1c', 2, '2026-09-20'], [$bundle['entry'][0]['source_document_id'], $bundle['entry'][0]['field_id'], $bundle['entry'][0]['page'], $bundle['entry'][0]['collection_date']]);
    same(['o2', 'o3'], $bundle['missing_observation_ids']);
    same(['o2'], $bundle['unlinked_observation_ids']);
    same([57, 60], $bundle['source_document_ids']);
    same('2026-09-20', LabHistoryAssembler::assemble([$row(57, ['o1'])], [$observation('o1', 57, '2026-09-20T00:00:00+00:00')], new DateTimeZone('UTC'), 'x')['entry'][0]['collection_date']);
});

echo "\n$passes passed, $failures failed\n";
exit($failures === 0 ? 0 : 1);
