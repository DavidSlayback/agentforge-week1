<?php

/**
 * Looks up the existing OpenEMR document category for a document type by name.
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
use OpenEMR\Modules\AgentForge\Domain\DocumentType;
use OpenEMR\Modules\AgentForge\Http\ApiError;

final readonly class CategoryResolver
{
    public function idFor(DocumentType $type): int
    {
        $id = QueryUtils::fetchSingleValue('SELECT id FROM categories WHERE name = ? ORDER BY id LIMIT 1', 'id', [$type->categoryName()]);
        if (!is_scalar($id) || preg_match('/^[1-9][0-9]*$/', (string) $id) !== 1) {
            throw new ApiError(503, 'module_not_configured', ['document_category_missing']);
        }
        return (int) $id;
    }
}
