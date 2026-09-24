<?php

/**
 * A canonical (lower-case, hyphenated) OpenEMR patient uuid.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

use OpenEMR\Modules\AgentForge\Http\ApiError;

final readonly class PatientUuid
{
    public string $value;

    public function __construct(string $value)
    {
        $normalized = strtolower($value);
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $normalized) !== 1) {
            throw ApiError::invalid(['patient_uuid_invalid']);
        }
        $this->value = $normalized;
    }
}
