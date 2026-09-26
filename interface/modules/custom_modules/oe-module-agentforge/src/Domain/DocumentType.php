<?php

/**
 * Document kinds the module stores. Persisted in the write ledger.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Domain;

enum DocumentType: string
{
    case LabPdf = 'lab_pdf';
    case IntakeForm = 'intake_form';
    case MedicationList = 'medication_list';
    case DerivedFacts = 'derived_facts';

    /**
     * Existing OpenEMR 8.0.0 categories (both aco_spec patients|docs). A
     * dedicated category would need a nested-set shift, so it is deferred.
     */
    public function categoryName(): string
    {
        return match ($this) {
            self::LabPdf => 'Lab Report',
            self::IntakeForm, self::MedicationList, self::DerivedFacts => 'Medical Record',
        };
    }

    /**
     * @return list<string>
     */
    public function allowedMimeTypes(): array
    {
        return match ($this) {
            // text/plain carries the synthetic tagged scan-form envelope used
            // by the deployed demo's "included scan sample"; it is still a
            // source document the extraction ran on.
            self::LabPdf, self::IntakeForm, self::MedicationList => ['application/pdf', 'text/plain'],
            self::DerivedFacts => ['application/json'],
        };
    }

    public function ledgerOperation(): string
    {
        return 'doc:' . $this->value;
    }

    /**
     * Source document kinds (everything the extraction runs on; derived facts
     * link to one of these).
     *
     * @return list<self>
     */
    public static function sourceTypes(): array
    {
        return [self::LabPdf, self::IntakeForm, self::MedicationList];
    }

    /**
     * Clinician-confirmed list entries this source may yield (A3): an intake
     * form lists medications and allergies; a medication list only medications.
     *
     * @return list<ListItemKind>
     */
    public function confirmableListItemKinds(): array
    {
        return match ($this) {
            self::IntakeForm => [ListItemKind::Medication, ListItemKind::Allergy],
            self::MedicationList => [ListItemKind::Medication],
            self::LabPdf, self::DerivedFacts => [],
        };
    }
}
