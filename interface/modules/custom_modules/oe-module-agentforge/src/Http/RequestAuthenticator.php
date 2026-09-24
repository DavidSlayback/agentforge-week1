<?php

/**
 * Parses and authenticates one raw module request (HMAC scheme v1).
 *
 * Order: shape checks, body hash, signature, clock skew, then the nonce is
 * claimed. Claiming last means an unsigned request cannot burn nonces.
 * Pure apart from the injected NonceStore.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

use OpenEMR\Modules\AgentForge\Persistence\NonceStore;

final readonly class RequestAuthenticator
{
    public const MAX_BODY_BYTES = 8 * 1024 * 1024;
    public const NONCE_TTL_SECONDS = 600;

    public function __construct(
        private HmacVerifier $verifier,
        private NonceStore $nonces,
    ) {
    }

    /**
     * @param array<array-key, mixed> $rawQuery
     * @param array<string, string>   $headers lower-cased header names
     */
    public function authenticate(string $method, array $rawQuery, array $headers, string $rawBody, int $now): SignedRequest
    {
        if ($method !== 'GET' && $method !== 'POST') {
            throw new ApiError(405, 'method_not_allowed');
        }
        $query = self::parseQuery($rawQuery);
        $route = $query['route'] ?? '';
        if ($route === '') {
            throw ApiError::invalid(['route_required']);
        }
        $site = $query['site'] ?? 'default';
        if (strlen($rawBody) > self::MAX_BODY_BYTES) {
            throw new ApiError(413, 'request_too_large');
        }

        $keyId = $headers['x-agentforge-key-id'] ?? '';
        $timestamp = $headers['x-agentforge-timestamp'] ?? '';
        $nonce = $headers['x-agentforge-nonce'] ?? '';
        $bodySha = $headers['x-agentforge-content-sha256'] ?? '';
        $signature = $headers['x-agentforge-signature'] ?? '';
        $contextToken = $headers['x-agentforge-context-token'] ?? '';
        if (
            $keyId !== HmacVerifier::KEY_ID
            || preg_match('/^[0-9]{1,12}$/', $timestamp) !== 1
            || preg_match('/^[0-9a-f]{32}$/', $nonce) !== 1
            || preg_match('/^[0-9a-f]{64}$/', $bodySha) !== 1
            || preg_match('/^[A-Za-z0-9_-]{43}$/', $signature) !== 1
            || strlen($contextToken) > 4096
        ) {
            throw new ApiError(401, 'signature_invalid');
        }
        if (!hash_equals(hash('sha256', $rawBody), $bodySha)) {
            throw new ApiError(401, 'signature_invalid');
        }

        $body = [];
        if ($method === 'POST') {
            $body = self::decodeObject($rawBody);
        } elseif ($rawBody !== '') {
            throw ApiError::invalid(['get_body_not_allowed']);
        }
        $patientUuid = $method === 'POST' ? ($body['patient_uuid'] ?? null) : ($query['patient_uuid'] ?? null);
        if ($patientUuid !== null && !is_string($patientUuid)) {
            throw ApiError::invalid(['patient_uuid_must_be_string']);
        }
        $contentSha = $method === 'POST' && is_string($body['content_sha256'] ?? null) ? $body['content_sha256'] : '';

        $canonical = new CanonicalRequest(
            $method,
            $route,
            $site,
            $patientUuid ?? '',
            $contentSha,
            $bodySha,
            $timestamp,
            $nonce,
            $query,
            $contextToken === '' ? '' : hash('sha256', $contextToken),
        );
        if (!$this->verifier->verify($canonical, $signature)) {
            throw new ApiError(401, 'signature_invalid');
        }
        $ts = (int) $timestamp;
        if (!HmacVerifier::withinSkew($ts, $now)) {
            throw new ApiError(401, 'timestamp_skew');
        }
        if (!$this->nonces->claim($nonce, $ts + self::NONCE_TTL_SECONDS, $now)) {
            throw new ApiError(409, 'nonce_replayed');
        }

        return new SignedRequest($method, $route, $site, $patientUuid, $body, $query, $contextToken === '' ? null : $contextToken, $ts, $nonce);
    }

    /**
     * @param array<array-key, mixed> $rawQuery
     * @return array<string, string>
     */
    private static function parseQuery(array $rawQuery): array
    {
        $query = [];
        foreach ($rawQuery as $key => $value) {
            if (!is_string($key) || preg_match(CanonicalRequest::QUERY_KEY_PATTERN, $key) !== 1) {
                throw ApiError::invalid(['query_key_invalid']);
            }
            if (!is_string($value) || preg_match(CanonicalRequest::QUERY_VALUE_PATTERN, $value) !== 1) {
                throw ApiError::invalid(['query_value_invalid']);
            }
            $query[$key] = $value;
        }
        return $query;
    }

    /**
     * @return array<string, mixed>
     */
    private static function decodeObject(string $rawBody): array
    {
        try {
            $decoded = json_decode($rawBody, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw ApiError::invalid(['body_must_be_json']);
        }
        if (!is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) {
            throw ApiError::invalid(['body_must_be_object']);
        }
        $object = [];
        foreach ($decoded as $key => $value) {
            $object[(string) $key] = $value;
        }
        return $object;
    }
}
