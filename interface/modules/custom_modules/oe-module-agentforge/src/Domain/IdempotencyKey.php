<?php

/**
 * Deterministic ledger keys. The same input on the same patient always maps
 * to the same key, so a retry or re-upload returns the first write.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

final readonly class IdempotencyKey
{
    private function __construct(public string $value)
    {
        if (strlen($value) > 160) {
            throw new \LengthException('Idempotency key exceeds the ledger column');
        }
    }

    public static function forDocument(int $pid, DocumentType $type, string $contentSha256): self
    {
        return new self(sprintf('doc:v1:%d:%s:%s', $pid, $type->value, self::sha($contentSha256)));
    }

    /**
     * Content-addressed (v2, W3 H1): the same derived facts for a source add
     * zero rows, and a re-extraction that produced different facts is stored
     * as its own derived-facts document instead of being reported as a
     * duplicate of the first. A reused key with another body is now a 409.
     */
    public static function forDerivedFacts(int $pid, int $sourceDocumentId, string $contentSha256): self
    {
        return new self(sprintf('derived:v2:%d:%d:%s', $pid, $sourceDocumentId, self::sha($contentSha256)));
    }

    public static function forLabResults(int $pid, string $sourceSha256): self
    {
        return new self(sprintf('lab:v1:%d:%s', $pid, self::sha($sourceSha256)));
    }

    public static function forListItem(int $pid, ListItemKind $kind, int $sourceDocumentId, string $title): self
    {
        $titleSha = hash('sha256', strtolower(trim($title)));
        return new self(sprintf('list:v1:%d:%s:%d:%s', $pid, $kind->value, $sourceDocumentId, $titleSha));
    }

    private static function sha(string $value): string
    {
        if (preg_match('/^[0-9a-f]{64}$/', $value) !== 1) {
            throw new \InvalidArgumentException('Expected a lower-case hex sha256');
        }
        return $value;
    }
}
