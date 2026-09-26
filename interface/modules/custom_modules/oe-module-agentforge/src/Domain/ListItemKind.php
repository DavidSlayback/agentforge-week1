<?php

/**
 * Clinician-confirmed list entries (from an intake form or a medication list)
 * the module may write.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

enum ListItemKind: string
{
    case Medication = 'medication';
    case Allergy = 'allergy';
}
