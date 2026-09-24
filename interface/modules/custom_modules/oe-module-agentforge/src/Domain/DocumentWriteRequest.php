<?php

/**
 * Parsed body of POST route=documents. Calling Document::createDocument
 * directly bypasses OpenEMR's secure_upload checks, so the content type is
 * verified here from the bytes, not trusted from the caller.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

use OpenEMR\Modules\AgentForge\Http\ApiError;

final readonly class DocumentWriteRequest
{
    public const MAX_CONTENT_BYTES = 5 * 1024 * 1024;

    private function __construct(
        public PatientUuid $patientUuid,
        public DocumentType $documentType,
        public string $filename,
        public string $mimeType,
        public string $contentSha256,
        public string $content,
        public ?int $sourceDocumentId,
    ) {
    }

    /**
     * @param array<string, mixed> $body
     */
    public static function fromBody(array $body): self
    {
        $issues = [];
        $patient = new PatientUuid(is_string($body['patient_uuid'] ?? null) ? $body['patient_uuid'] : '');
        $type = is_string($body['document_type'] ?? null) ? DocumentType::tryFrom($body['document_type']) : null;
        if ($type === null) {
            throw ApiError::invalid(['document_type_invalid']);
        }
        $filename = is_string($body['filename'] ?? null) ? $body['filename'] : '';
        if (
            $filename === '' || strlen($filename) > 255 || str_contains($filename, '/') || str_contains($filename, '\\')
            || str_contains($filename, '..') || preg_match('/[\x00-\x1f\x7f]/', $filename) === 1
        ) {
            $issues[] = 'filename_invalid';
        }
        $mime = is_string($body['mime_type'] ?? null) ? $body['mime_type'] : '';
        if (!in_array($mime, $type->allowedMimeTypes(), true)) {
            $issues[] = 'mime_type_not_allowed';
        }
        $sha = is_string($body['content_sha256'] ?? null) ? $body['content_sha256'] : '';
        if (preg_match('/^[0-9a-f]{64}$/', $sha) !== 1) {
            $issues[] = 'content_sha256_invalid';
        }
        $encoded = is_string($body['content_base64'] ?? null) ? $body['content_base64'] : '';
        $content = base64_decode($encoded, true);
        if ($content === false || $content === '') {
            $issues[] = 'content_base64_invalid';
            $content = '';
        } elseif (strlen($content) > self::MAX_CONTENT_BYTES) {
            throw new ApiError(413, 'request_too_large');
        }
        $sourceId = $body['source_document_id'] ?? null;
        if ($type === DocumentType::DerivedFacts) {
            if (!is_int($sourceId) || $sourceId <= 0) {
                $issues[] = 'source_document_id_required';
                $sourceId = null;
            }
        } elseif ($sourceId !== null) {
            $issues[] = 'source_document_id_not_allowed';
        }
        if ($issues !== []) {
            throw ApiError::invalid($issues);
        }
        if (!hash_equals($sha, hash('sha256', $content))) {
            throw ApiError::invalid(['content_sha256_mismatch']);
        }
        $contentIssue = self::contentIssue($mime, $filename, $content);
        if ($contentIssue !== null) {
            throw ApiError::invalid([$contentIssue]);
        }
        return new self($patient, $type, $filename, $mime, $sha, $content, is_int($sourceId) ? $sourceId : null);
    }

    public static function contentIssue(string $mime, string $filename, string $content): ?string
    {
        return match ($mime) {
            'application/pdf' => str_starts_with($content, '%PDF-') ? null : 'content_not_pdf',
            'text/plain' => (str_ends_with(strtolower($filename), '.txt') && !str_contains($content, "\0") && preg_match('//u', $content) === 1) ? null : 'content_not_utf8_text',
            'application/json' => self::isJsonObject($content) ? null : 'content_not_json_object',
            default => 'mime_type_not_allowed',
        };
    }

    public function payloadSha256(): string
    {
        return hash('sha256', implode('|', [$this->documentType->value, $this->filename, $this->mimeType, $this->contentSha256, (string) ($this->sourceDocumentId ?? '-')]));
    }

    private static function isJsonObject(string $content): bool
    {
        try {
            $decoded = json_decode($content, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return false;
        }
        return is_array($decoded) && ($decoded === [] || !array_is_list($decoded));
    }
}
