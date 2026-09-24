<?php

/**
 * Reads a module-stored document back through OpenEMR (decrypting via
 * Document::get_data), so byte identity is checked on what OpenEMR returns,
 * not on the encrypted file on disk.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Read;

use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\AgentForge\Http\ApiError;
use OpenEMR\Modules\AgentForge\Persistence\LedgerEntry;

final readonly class DocumentReader
{
    /**
     * @return array<string, mixed>
     */
    public function read(int $pid, int $documentId, LedgerEntry $ledgerRow): array
    {
        $document = new \Document($documentId);
        if ((string) $document->get_foreign_id() !== (string) $pid || $document->is_deleted() || $document->has_expired()) {
            throw new ApiError(404, 'document_not_found');
        }
        $data = $document->get_data();
        if (!is_string($data)) {
            throw new \RuntimeException('Document::get_data failed to return content');
        }
        $uuid = $document->get_uuid();
        $hash = $document->get_hash();
        return [
            'document_id' => $documentId,
            'document_uuid' => is_string($uuid) && strlen($uuid) === 16 ? UuidRegistry::uuidToString($uuid) : null,
            'document_type' => substr($ledgerRow->operation, strlen('doc:')),
            'filename' => $document->get_name(),
            'mime_type' => $document->get_mimetype(),
            'size_bytes' => strlen($data),
            'content_sha256' => hash('sha256', $data),
            'ledger_content_sha256' => $ledgerRow->contentSha256,
            'sha3_512_matches_documents_hash' => is_string($hash) && hash_equals($hash, hash('sha3-512', $data)),
            'source_document_id' => $ledgerRow->response['source_document_id'] ?? null,
            'content_base64' => base64_encode($data),
            'read_path' => 'openemr-document-get-data',
        ];
    }
}
