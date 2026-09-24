<?php

/**
 * Writes JSON responses for the module endpoint.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

final readonly class JsonResponder
{
    /**
     * @param array<string, mixed> $body
     */
    public function send(int $status, array $body, string $correlationId = ''): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        header('Cache-Control: no-store');
        if ($correlationId !== '') {
            header('X-Correlation-Id: ' . $correlationId);
        }
        echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }
}
