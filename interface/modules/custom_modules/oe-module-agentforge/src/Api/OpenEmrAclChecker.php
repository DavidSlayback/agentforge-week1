<?php

/**
 * AclChecker backed by OpenEMR 8.0.0 AclMain (gacl ARO value = username).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Api;

use OpenEMR\Common\Acl\AclMain;

final readonly class OpenEmrAclChecker implements AclChecker
{
    public function allows(string $section, string $value, string $username, bool $write): bool
    {
        if ($username === '') {
            return false; // an empty user would fall back to the (absent) session user
        }
        return AclMain::aclCheckCore($section, $value, $username, $write ? ['write', 'addonly'] : '');
    }
}
