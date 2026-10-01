<?php

/**
 * Public half of the OpenEMR launcher's Ed25519 key (AGENTFORGE_LAUNCH_VERIFY_KEY).
 *
 * Launcher tokens (issuer openemr-module) are signed with the private half,
 * which only the openemr container holds (LaunchSigningKey). Anything that
 * holds AGENTFORGE_DEMO_SECRET (the frozen Week 1 service, agentforge-w2) can
 * verify launcher tokens with this key but can never mint one.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

final readonly class LaunchVerifyKey
{
    public const PUBLIC_KEY_BYTES = 32;
    public const SIGNATURE_BYTES = 64;

    private function __construct(private string $publicKey)
    {
    }

    /**
     * Strict base64 of the 32-byte public key; anything else is refused.
     */
    public static function fromBase64(string $raw): self
    {
        self::requireSodium();
        $bytes = base64_decode($raw, true);
        if ($bytes === false || strlen($bytes) !== self::PUBLIC_KEY_BYTES || base64_encode($bytes) !== $raw) {
            throw new \InvalidArgumentException('AgentForge launch verify key must be base64 of a 32-byte Ed25519 public key');
        }
        return new self($bytes);
    }

    public function verify(string $message, string $signature): bool
    {
        if (strlen($signature) !== self::SIGNATURE_BYTES) {
            return false;
        }
        try {
            return sodium_crypto_sign_verify_detached($signature, $message, $this->publicKey);
        } catch (\SodiumException) {
            return false;
        }
    }

    public function equals(self $other): bool
    {
        return hash_equals($this->publicKey, $other->publicKey);
    }

    public static function requireSodium(): void
    {
        if (!function_exists('sodium_crypto_sign_verify_detached')) {
            throw new \RuntimeException('ext-sodium is required for AgentForge launch tokens');
        }
    }
}
