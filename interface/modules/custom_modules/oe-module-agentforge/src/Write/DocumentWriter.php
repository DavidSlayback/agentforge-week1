<?php

/**
 * Stores bytes as an OpenEMR patient document through the 8.0.0
 * Document::createDocument signature (12 arguments; no $eid).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\AgentForge\Domain\Actor;
use OpenEMR\Modules\AgentForge\Domain\DocumentWriteRequest;
use OpenEMR\Modules\AgentForge\Persistence\WriteOutcome;

final readonly class DocumentWriter
{
    public function write(int $pid, int $categoryId, string $categoryName, DocumentWriteRequest $request, Actor $actor): WriteOutcome
    {
        $document = new \Document();
        $data = $request->content;
        $referenceId = $request->sourceDocumentId;
        $error = $document->createDocument(
            $pid,
            $categoryId,
            $request->filename,
            $request->mimeType,
            $data,
            '',
            1,
            $actor->userId, // explicit: there is no session authUserID on this endpoint
            null,
            null,
            $referenceId,
            $referenceId === null ? null : 'documents',
        );
        if ($error !== '') {
            throw new \RuntimeException('Document::createDocument returned an error');
        }
        $id = $document->get_id();
        if (!is_numeric($id) || (int) $id <= 0) {
            throw new \RuntimeException('Document::createDocument did not produce an id');
        }
        $uuid = $document->get_uuid();
        return new WriteOutcome(
            [
                'document_id' => (int) $id,
                'document_uuid' => is_string($uuid) && strlen($uuid) === 16 ? UuidRegistry::uuidToString($uuid) : null,
                'document_type' => $request->documentType->value,
                'category' => $categoryName,
                'content_sha256' => $request->contentSha256,
                'size_bytes' => strlen($request->content),
                'mime_type' => $request->mimeType,
                'source_document_id' => $referenceId,
                'persistence_boundary' => 'openemr-module',
            ],
            (int) $id,
            null,
            1,
        );
    }
}
