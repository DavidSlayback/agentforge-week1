<?php

/**
 * What one launcher visit may hand to the W2 service (LaunchTokenMinter::grant).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Launch;

enum LaunchGrant
{
    case None;
    case NotDesignated;
    case ReadOnly;
    case ReadAndUpload;
}
