<?php

/**
 * A request whose HMAC signature, clock skew and nonce have all been checked.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

final readonly class SignedRequest
{
    /**
     * @param array<string, mixed>  $body  decoded JSON object (empty for GET)
     * @param array<string, string> $query
     */
    public function __construct(
        public string $method,
        public string $route,
        public string $site,
        public ?string $patientUuid,
        public array $body,
        public array $query,
        public ?string $contextToken,
        public int $timestamp,
        public string $nonce,
    ) {
    }

    public function queryInt(string $key): ?int
    {
        $value = $this->query[$key] ?? null;
        if ($value === null || preg_match('/^[1-9][0-9]{0,17}$/', $value) !== 1) {
            return null;
        }
        return (int) $value;
    }
}
