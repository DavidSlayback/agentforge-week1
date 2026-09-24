<?php

/**
 * The signed view of one module request (HMAC scheme v1).
 *
 * Every line is fixed-order and newline-joined; absent optional values are
 * written as "-". The Node client (agentforge/src/openemrModuleClient.js)
 * builds the identical string, and both sides are pinned by the shared
 * vectors in agentforge/test/fixtures/hmac-vectors.json.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

final readonly class CanonicalRequest
{
    public const SCHEME = 'AGENTFORGE-HMAC-SHA256-V1';
    public const QUERY_KEY_PATTERN = '/^[a-z_]{1,40}$/';
    public const QUERY_VALUE_PATTERN = '/^[A-Za-z0-9._-]{1,128}$/';

    /**
     * @param array<string, string> $query every query parameter, including route and site
     */
    public function __construct(
        public string $method,
        public string $route,
        public string $site,
        public string $patientUuid,
        public string $contentSha256,
        public string $bodySha256,
        public string $timestamp,
        public string $nonce,
        public array $query,
        public string $contextTokenSha256,
    ) {
    }

    /**
     * Sorted "key=value" pairs joined by "&". Keys and values are restricted to
     * a URL-safe alphabet, so no percent-encoding rules can drift between
     * languages.
     *
     * @param array<string, string> $query
     */
    public static function canonicalQuery(array $query): string
    {
        if ($query === []) {
            return '-';
        }
        ksort($query, SORT_STRING);
        $pairs = [];
        foreach ($query as $key => $value) {
            $pairs[] = $key . '=' . $value;
        }
        return implode('&', $pairs);
    }

    public function toString(): string
    {
        return implode("\n", [
            self::SCHEME,
            $this->method,
            $this->route,
            $this->site,
            $this->patientUuid === '' ? '-' : $this->patientUuid,
            $this->contentSha256 === '' ? '-' : $this->contentSha256,
            $this->bodySha256,
            $this->timestamp,
            $this->nonce,
            self::canonicalQuery($this->query),
            $this->contextTokenSha256 === '' ? '-' : $this->contextTokenSha256,
        ]);
    }
}
