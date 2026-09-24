<?php

/**
 * agentforge_request_nonce: a primary-key insert in autocommit, before any
 * write, so a replayed nonce fails on the duplicate key.
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
use OpenEMR\Common\Database\SqlQueryException;

final readonly class SqlNonceStore implements NonceStore
{
    public function claim(string $nonce, int $expiresAt, int $now): bool
    {
        QueryUtils::sqlStatementThrowException('DELETE FROM agentforge_request_nonce WHERE expires_at < ?', [$now], true);
        try {
            QueryUtils::sqlStatementThrowException('INSERT INTO agentforge_request_nonce (nonce, expires_at) VALUES (?, ?)', [$nonce, $expiresAt], true);
            return true;
        } catch (SqlQueryException $e) {
            $used = QueryUtils::fetchSingleValue('SELECT COUNT(*) AS used FROM agentforge_request_nonce WHERE nonce = ?', 'used', [$nonce]);
            if ((int) $used > 0) {
                return false;
            }
            throw $e;
        }
    }
}
