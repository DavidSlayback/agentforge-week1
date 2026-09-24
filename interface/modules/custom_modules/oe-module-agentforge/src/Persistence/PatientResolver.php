<?php

/**
 * Maps an OpenEMR patient uuid to its pid.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\AgentForge\Domain\PatientUuid;
use OpenEMR\Modules\AgentForge\Http\ApiError;

final readonly class PatientResolver
{
    public function pidFor(PatientUuid $uuid): int
    {
        $pid = QueryUtils::fetchSingleValue('SELECT pid FROM patient_data WHERE uuid = ?', 'pid', [UuidRegistry::uuidToBytes($uuid->value)]);
        if (!is_scalar($pid) || preg_match('/^[1-9][0-9]*$/', (string) $pid) !== 1) {
            throw new ApiError(404, 'patient_not_found');
        }
        return (int) $pid;
    }
}
