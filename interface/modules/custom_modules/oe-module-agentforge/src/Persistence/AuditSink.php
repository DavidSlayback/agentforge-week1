<?php

/**
 * Records that a write happened. Never receives values, names or content.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

use OpenEMR\Modules\AgentForge\Domain\Actor;

interface AuditSink
{
    public function recordWrite(string $operation, Actor $actor, int $pid, ?int $documentId, int $rowCount): void;
}
