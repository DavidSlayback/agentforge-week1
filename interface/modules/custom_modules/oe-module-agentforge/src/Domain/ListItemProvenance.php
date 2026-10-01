<?php

/**
 * What a clinical-list-items write may claim about who confirmed it (W3 H1).
 *
 * Only an openemr-module token (minted by the launcher from a logged-in
 * OpenEMR session, Ed25519-signed) is a clinician confirmation. A
 * synthetic-demo token comes from the anonymous public demo, so its rows say
 * so and an allergy stays 'unconfirmed' (list allergyintolerance-verification).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

enum ListItemProvenance
{
    case ClinicianConfirmed;
    case UnauthenticatedSyntheticDemo;

    public static function forActor(Actor $actor): self
    {
        return match ($actor->issuer) {
            ContextClaims::ISSUER_OPENEMR_MODULE => self::ClinicianConfirmed,
            ContextClaims::ISSUER_SYNTHETIC_DEMO => self::UnauthenticatedSyntheticDemo,
            default => throw new \DomainException('Unknown context issuer for a list write'),
        };
    }

    /** lists.comments: source document and confirmation event ids only. */
    public function comment(int $sourceDocumentId, string $confirmationEventId): string
    {
        return match ($this) {
            self::ClinicianConfirmed => sprintf('AgentForge intake doc %d; clinician-confirmed %s', $sourceDocumentId, $confirmationEventId),
            self::UnauthenticatedSyntheticDemo => sprintf('AgentForge intake doc %d; unauthenticated synthetic-demo action %s (not clinician-confirmed)', $sourceDocumentId, $confirmationEventId),
        };
    }

    /** lists.verification (allergyintolerance-verification option ids); empty for medications. */
    public function verification(ListItemKind $kind): string
    {
        return match ($kind) {
            ListItemKind::Medication => '',
            ListItemKind::Allergy => match ($this) {
                self::ClinicianConfirmed => 'confirmed',
                self::UnauthenticatedSyntheticDemo => 'unconfirmed',
            },
        };
    }
}
