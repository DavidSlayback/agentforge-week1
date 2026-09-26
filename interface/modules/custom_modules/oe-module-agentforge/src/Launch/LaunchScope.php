<?php

/**
 * Context-token scopes the launcher mints, with the acl each scope requires.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Launch;

enum LaunchScope
{
    case ReadBriefing;
    case WriteSourceDocument;

    public function scope(): string
    {
        return match ($this) {
            self::ReadBriefing => 'read-briefing',
            self::WriteSourceDocument => 'write-source-document',
        };
    }

    public function acl(): string
    {
        return match ($this) {
            self::ReadBriefing => 'read',
            self::WriteSourceDocument => 'write',
        };
    }
}
