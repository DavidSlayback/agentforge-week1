<?php

/**
 * Result of an idempotent write: the stored response and whether it is new.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Persistence;

final readonly class IdempotentResult
{
    /**
     * @param array<string, mixed> $response
     */
    public function __construct(
        public bool $created,
        public array $response,
    ) {
    }

    public function httpStatus(): int
    {
        return $this->created ? 201 : 200;
    }

    /**
     * @return array<string, mixed>
     */
    public function body(): array
    {
        return ['status' => $this->created ? 'created' : 'duplicate'] + $this->response;
    }
}
