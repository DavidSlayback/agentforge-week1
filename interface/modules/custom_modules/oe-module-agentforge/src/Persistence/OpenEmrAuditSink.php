<?php

/**
 * Writes one OpenEMR audit-log event per AgentForge write: operation, ids,
 * row count and issuer only, never values, names or document text.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

use OpenEMR\Common\Logging\EventAuditLogger;
use OpenEMR\Modules\AgentForge\Domain\Actor;

final readonly class OpenEmrAuditSink implements AuditSink
{
    public function recordWrite(string $operation, Actor $actor, int $pid, ?int $documentId, int $rowCount): void
    {
        EventAuditLogger::getInstance()->newEvent(
            'agentforge-write',
            $actor->username,
            'Default',
            1,
            sprintf('op=%s doc=%s n=%d issuer=%s', $operation, $documentId === null ? '-' : (string) $documentId, $rowCount, $actor->issuer),
            $pid,
        );
    }
}
