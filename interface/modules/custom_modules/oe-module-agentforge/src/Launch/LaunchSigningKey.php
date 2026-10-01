<?php

/**
 * Private half of the OpenEMR launcher's Ed25519 key (AGENTFORGE_LAUNCH_SIGNING_KEY,
 * base64 of the 32-byte seed). Only the openemr container holds it; it signs
 * the launcher's openemr-module context tokens (LaunchTokenMinter).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Launch;

use OpenEMR\Modules\AgentForge\Http\LaunchVerifyKey;

final readonly class LaunchSigningKey
{
    public const SEED_BYTES = 32;

    private function __construct(
        private string $secretKey,
        public LaunchVerifyKey $verifyKey,
    ) {
    }

    /**
     * @param string $seedBase64      AGENTFORGE_LAUNCH_SIGNING_KEY
     * @param string $verifyKeyBase64 AGENTFORGE_LAUNCH_VERIFY_KEY; when set it must be this seed's public key
     */
    public static function fromBase64Seed(string $seedBase64, string $verifyKeyBase64 = ''): self
    {
        LaunchVerifyKey::requireSodium();
        $seed = base64_decode($seedBase64, true);
        if ($seed === false || strlen($seed) !== self::SEED_BYTES || base64_encode($seed) !== $seedBase64) {
            throw new \InvalidArgumentException('AgentForge launch signing key must be base64 of a 32-byte Ed25519 seed');
        }
        $keyPair = sodium_crypto_sign_seed_keypair($seed);
        $verifyKey = LaunchVerifyKey::fromBase64(base64_encode(sodium_crypto_sign_publickey($keyPair)));
        if ($verifyKeyBase64 !== '' && !$verifyKey->equals(LaunchVerifyKey::fromBase64($verifyKeyBase64))) {
            throw new \InvalidArgumentException('AgentForge launch verify key is not the public key of the signing key');
        }
        return new self(sodium_crypto_sign_secretkey($keyPair), $verifyKey);
    }

    public function sign(string $message): string
    {
        return sodium_crypto_sign_detached($message, $this->secretKey);
    }
}
