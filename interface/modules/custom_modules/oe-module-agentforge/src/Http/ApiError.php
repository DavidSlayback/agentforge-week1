<?php

/**
 * A request failure with a public HTTP status and a stable error code.
 *
 * The message is never sent to the client; only the code and issue codes are.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

final class ApiError extends \RuntimeException
{
    /**
     * @param list<string> $issues
     */
    public function __construct(
        public readonly int $httpStatus,
        public readonly string $errorCode,
        public readonly array $issues = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct($errorCode, 0, $previous);
    }

    /**
     * @param list<string> $issues
     */
    public static function invalid(array $issues): self
    {
        return new self(400, 'invalid_request', $issues);
    }

    /**
     * @return array{error: string, issues?: list<string>}
     */
    public function toBody(): array
    {
        return $this->issues === [] ? ['error' => $this->errorCode] : ['error' => $this->errorCode, 'issues' => $this->issues];
    }
}
