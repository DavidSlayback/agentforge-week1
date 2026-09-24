<?php

/**
 * Verified claims from a launcher-format context token.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

final readonly class ContextClaims
{
    public const ISSUER_OPENEMR_MODULE = 'openemr-module';
    public const ISSUER_SYNTHETIC_DEMO = 'synthetic-demo';

    public function __construct(
        public string $patientUuid,
        public string $clinicianUuid,
        public string $scope,
        public string $issuer,
        public string $authn,
        public string $acl,
        public int $expiresAt,
    ) {
    }
}
