# Lopez RPTS Project: Legal and Regulatory Compliance Assessment

**Review date:** 15 October 2026  
**Repository branch reviewed:** `login-page-modified`  
**Review type:** Read-only static review of application source and Supabase migration/seed files

## Executive assessment

The original baseline review identified risks in provisional configuration, effective-period handling, exemptions, valuation evidence, database permissions, and financial posting. This branch now implements controls for several of those findings, as detailed in the Implementation update below. Remaining gaps and required deployment/configuration steps are listed there. The changes reduce specific software risks but do **not demonstrate legal compliance** or certify the system against Lopez’s current local rules.

Treat the application as a prototype or controlled test system until the findings below are resolved and its configuration is checked against Lopez’s current ordinances, certified valuation schedule, and applicable DOF/BLGF and COA requirements. This assessment is based on repository code only. It does not inspect the live Supabase database, deployed frontend, local ordinances, or actual operating procedures, and it is not a legal opinion or certification.

## Scope and legal references

The review considered the project’s assessment, billing, collection, data model, seed configuration, and Supabase access policies against the Local Government Code (Republic Act No. 7160), the Real Property Valuation and Assessment Reform Act (Republic Act No. 12001), and its Implementing Rules and Regulations. Relevant official references:

- [Republic Act No. 7160 — Official Gazette](https://officialgazette.gov.ph/1991/10/10/republic-act-no-7160/)
- [Republic Act No. 12001 — Supreme Court E-Library](https://elibrary.judiciary.gov.ph//thebookshelf//showdocs/2/97502)
- [Implementing Rules and Regulations of RA 12001 — Supreme Court E-Library](https://elibrary.judiciary.gov.ph//thebookshelf//showdocs/2/101194)

## Baseline findings

The findings below describe the state reviewed on 15 October 2026. Their implementation status as of 16 October 2026 is summarized in the Implementation update.

### High priority

1. **Provisional seed values can be used for billing.** The seed migration describes tax rates, assessment levels, and the valuation schedule as pending certification, but records some of them with an `active` status. The billing page selects active rates, so provisional settings can enter generated tax charges. Official billing should be blocked until the applicable values have been reviewed, certified/adopted, and made effective.

   References: [seeded assessment levels and rates](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/supabase/migrations/20261011062758_002_seed_data.sql:121>); [billing rate lookup](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/src/pages/BillingPage.tsx:236>).

2. **Billing does not select rates by tax year or effective period.** The billing flow reads active tax rates without filtering them to the tax year or billing date. A rate can therefore be selected even if its effective date does not cover the tax obligation being generated. Rates must be resolved for the correct jurisdiction, levy, and effective period.

   References: [billing rate lookup](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/src/pages/BillingPage.tsx:236>); [tax-rate configuration](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/src/pages/ConfigurationPage.tsx:393>).

3. **Exempt units are not visibly excluded during charge generation.** Property units have an exemption flag and supporting fields, but the billing generation path selects approved assessments without checking the linked unit’s exemption status. This can produce charges for exempt units unless another control outside the reviewed path prevents it. RA 7160 Section 234 defines statutory real-property-tax exemptions.

   References: [property-unit exemption field](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/supabase/migrations/20261011062619_001_create_core_schema.sql:446>); [billing assessment selection](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/src/pages/BillingPage.tsx:273>); [RA 7160](https://officialgazette.gov.ph/1991/10/10/republic-act-no-7160/).

4. **Assessment can proceed without a required approved valuation basis.** The schema contains valuation schedules and worksheets, but assessment references to schedule and worksheet are nullable. The assessment screen permits manual entry of market value and does not visibly require an approved schedule or completed worksheet. RPVARA and its IRR require market-value-based valuation in accordance with the Philippine Valuation Standards and the applicable approved Schedule of Market Values.

   References: [assessment entry flow](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/src/pages/AssessmentPage.tsx:300>); [assessment schema](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/supabase/migrations/20261011062619_001_create_core_schema.sql:525>); [RA 12001](https://elibrary.judiciary.gov.ph//thebookshelf//showdocs/2/97502); [RA 12001 IRR](https://elibrary.judiciary.gov.ph//thebookshelf//showdocs/2/101194).

5. **Database permissions do not enforce role-specific duties for general RPT tables.** The current staff policy grants every active staff user `FOR ALL` on a group of application tables. This includes delete access. Page-level role restrictions in the frontend do not substitute for database-side authorization, because direct database requests can bypass the UI. Database policies should enforce least privilege and separation of assessor, treasurer, administrator, and other duties.

   Reference: [staff table policies](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/supabase/migrations/20261013090000_006_citizen_portal_auth.sql:150>).

### Medium priority

6. **Configured discount rules are not applied in the reviewed billing/collection flow.** The charge-generation code sets discount amounts to zero. RA 7160 Section 251 allows an advance-payment discount up to the statutory ceiling when authorized by the sanggunian. The system should apply only the locally authorized amount, dates, and eligibility rules.

   References: [charge calculation](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/src/pages/BillingPage.tsx:319>); [discount rule configuration](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/src/pages/ConfigurationPage.tsx:466>); [RA 7160](https://officialgazette.gov.ph/1991/10/10/republic-act-no-7160/).

7. **Collection posting uses multiple independent writes and revenue shares are hard-coded.** The collection screen writes related payment, allocation, balance, receipt, and session data through separate operations rather than one visible atomic server-side posting. A partial failure could leave records inconsistent. The revenue-share helper also uses fixed percentages rather than resolving the applicable jurisdiction and levy configuration. RA 7160 Section 250 requires payments to be applied first to prior-year delinquencies, interest, and penalties before current-period charges; this should be enforced by the server-side payment workflow.

   References: [collection posting flow](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/src/pages/CollectionPage.tsx:323>); [revenue-share calculation](<F:/LGU Projects/Lopez - RPTS/rpts-lopez-chatgpt/src/lib/utils.ts:121>); [RA 7160](https://officialgazette.gov.ph/1991/10/10/republic-act-no-7160/).

## Existing foundations

The repository already models several useful RPT concepts: properties and ownership interests, assessment approval states, valuation schedules and worksheets, tax charges, payment allocations, receipts, cash sessions, and cases. It also includes effective-date fields and exemption records. These are useful foundations, but the current workflows do not consistently require or enforce them.

## Recommended remediation order

1. Prevent provisional schedules, tax rates, and assessment levels from being used for official billing until they are certified/adopted and effective.
2. Resolve rates and assessment levels by jurisdiction, levy, and the applicable tax/effective period.
3. Exclude exempt property units from charge generation and require review of exemption basis and authority.
4. Require a valid valuation basis and supporting worksheet or approved schedule for each assessment; preserve approval and change history.
5. Move assessment approval, billing generation, and payment posting into validated server-side operations. Use database transactions for multi-record postings.
6. Enforce role-specific database permissions, payment ordering, locally authorized discounts, levy-specific revenue handling, and centavo reconciliation.
7. Validate outputs and procedures with Lopez’s current ordinances and the applicable DOF/BLGF and COA requirements before operational deployment.

## Conclusion

The project partially reflects the required RPT concepts, but it does not yet demonstrate legal and regulatory compliance. The most significant risks are use of provisional configuration for billing, missing effective-period and exemption checks, assessments without a required approved valuation basis, and broad database permissions. Resolve those issues and validate the implementation against Lopez’s official local rules before using the system for official assessment or collection.


## Implementation update — 16 October 2026

The following recommendations have been implemented in the `legal-regulatory-compliance` branch. The changes are present in the repository source and a new Supabase migration; they have not been applied to a live Supabase project.

### Implemented in code and migration

- **Provisional configuration fails closed.** Pending tax rates, assessment levels, and discount rules are deactivated. Assessment approval now requires an effective certified/in-force valuation schedule, an active legally sourced assessment level matching the assessment, an active property unit, and arithmetic consistency between market and assessed value.
- **Billing is server-side and period-aware.** A database function generates charges transactionally for the latest approved assessment of active, non-exempt units. It requires four due dates, effective rates for the complete tax year, exactly one authorized rate per levy, valid ordinance/legal references, and statutory rate ceilings. Quarterly centavo remainders are assigned across the first quarters so totals reconcile. Existing charges are not duplicated.
- **Rate configuration supports retirement dates.** Tax-rate records have an optional end date in the configuration form and list. Billing requires a rate to cover the full tax year.
- **Collection posting is atomic and database-validated.** A database function checks active staff and collection permission, an open cashier session, charge state, payment ordering, statutory interest, eligible full-year advance discounts, tender, levy-sharing configuration, and sequential receipt creation before committing all related records. Session opening and closing also use database functions. Direct financial-table writes are restricted.
- **Database permissions are role-scoped.** Broad staff CRUD policies are replaced with permission-specific select/insert/update controls. Generic deletes are removed; payment, receipt, allocation, charge, and cash-session changes are performed through guarded workflows.
- **Audit history is captured.** An append-only audit table and triggers record changes to configuration, property, assessment, and financial records; reconciliation-permitted roles can read the events.
- **UI guidance reflects server behavior.** Billing explains the legal inputs it requires, and collection labels the pre-posting change estimate as an estimate.

### Migration and validation required before operational use

1. Review `supabase/migrations/20261016000000_007_compliance_controls.sql` with the project database owner, then apply it to the intended Supabase project. No live database was inspected or changed during this implementation.
2. Enter Lopez-approved jurisdiction, certified valuation schedule, assessment levels, tax rates with ordinance/legal citations and valid dates, due dates, levy-sharing configuration, and authorized discount rules. Seeded illustrative values remain unsuitable for official billing.
3. Confirm legacy unpaid charges and historical balances before using the new posting workflow; this migration does not recalculate, cancel, or migrate existing financial records.
4. Confirm receipt numbering against the Treasurer’s authorized accountable-form process. The database sequence prevents application-side random numbering but does not by itself establish an approved official receipt series.
5. Confirm accounting treatment and distribution of interest, penalties, discounts, and proceeds against local ordinances, DOF/BLGF guidance, and COA requirements. The current distribution uses the configured levy shares for principal; accounting approval is still required for other components.
6. Complete valuation schedule line-item support and evidence-driven market-value derivation. The approval guard validates schedule linkage, dates, authorization references, assessment level, and arithmetic, but this version does not calculate market value from schedule line items or require a completed worksheet in the UI.
7. Review and approve the database policies against the actual staff roles and least-privilege duties, and confirm there are no other permissive policies that unintentionally broaden access.

No build, automated tests, or live Supabase deployment was performed as part of this implementation. These code changes reduce the specific risks identified above but do not constitute legal certification or establish that the configured system complies with Lopez’s current local enactments and operating controls.


## Citizens portal property-link update — 16 October 2026

The citizens portal previously refreshed `taxpayer_property_access` only when a taxpayer record was first linked to Supabase Auth. If staff added or corrected a property ownership relationship later, an already-linked citizen account could continue to see an empty property list. The `citizen-account` edge function now supports an authenticated refresh action, and the client invokes it for confirmed taxpayer accounts during profile resolution. The mapping refresh continues to use the municipal party-to-taxpayer email match; it does not grant access based on a PIN alone.

The portal now displays access-refresh and query failures rather than silently showing an empty dashboard, and gives a clear “no linked properties” message with PIN LOP-006-002-002 as the example reported for investigation. If that PIN still does not appear after deploying the updated edge function and signing in again, the municipal property record’s declared-owner party and email must be checked against the active taxpayer account. No live database records were inspected or changed.


### Manual taxpayer-property access troubleshooting

`taxpayer_property_access.taxpayer_user_id` is a UUID foreign key to `taxpayer_users.id`, and `property_id` is a UUID foreign key to `properties.id`. It does not accept the human-readable `taxpayer_id` string or the PIN in those columns. The Citizens Portal now includes a Refresh property list action for links added while a session is open. If a property remains absent after refresh, verify that the access row points to the `taxpayer_users` row linked to the signed-in auth account and to the `properties` row whose PIN is expected.


### Citizens portal TypeScript correction — 16 October 2026

Fixed the `PropertiesView` component’s missing `taxpayer` prop. The property detail card displays the account holder’s name, so `TaxpayerPortal` now passes its authenticated taxpayer profile into the child component with an explicit nullable type.


### Cash-session RPC schema-cache note — 16 October 2026

The compliance migration defines and grants `public.open_rpt_cash_session()` with no arguments, matching the Collection page RPC call. It now ends with `NOTIFY pgrst, 'reload schema';` so the API refreshes its function cache after migration. If the app reports that the function cannot be found, first confirm the migration was applied to the same Supabase project used by the frontend; if the function exists but remains undiscoverable, reload the PostgREST schema cache.


### Collection property search correction — 17 October 2026

Fixed the Collection and Payment property lookup. The previous PostgREST request tried to apply a root `.or()` logic-tree filter to fields on the embedded `properties` relationship, which PostgREST rejected. The page now searches PIN and tax-declaration number directly on `properties`, combines the matching property UUIDs, and loads unpaid or partially paid charges by `property_id`.


### Payment posting UUID aggregate correction — 17 October 2026

Fixed the payment and billing SQL definitions after PostgreSQL reported `function min(uuid) does not exist`. PostgreSQL does not provide `min`/`max` aggregates for UUID values in this environment. Property and jurisdiction UUID selection now uses `array_agg` (the associated counts still determine when one unique value is expected). The updated migration must be rerun against the target Supabase project so the `generate_rpt_charges` and `post_rpt_payment` function definitions are replaced.


### Revenue Summary report loading correction — 17 October 2026

The Revenue Summary query used `payment_date` to split payment allocations between the selected year and the previous year, but did not include `payment_date` in the selected payment fields. That left the date undefined during client-side grouping and could throw before the component cleared its loading state. The query now selects `payment_date`. The loader also catches query and processing errors and always clears the loading indicator, allowing the report to display an error instead of spinning indefinitely.


### Reports Print / Export button correction — 17 October 2026

The shared report header displayed a Print / Export button without an `onClick` handler, so clicking it had no effect. The button now opens the browser print dialog with `window.print()`. Users can print the report or choose the browser’s Save as PDF destination. The action is shared by all report types because they use the same report header.


### Reports CSV and Excel-compatible export — 17 October 2026

Expanded the shared Print / Export menu with CSV and Excel-compatible `.xls` downloads. Exports use the visible report tables and include the report title and generation date. CSV fields are quoted and formula-like cell values are escaped to reduce spreadsheet formula-injection risk. The Excel option uses an HTML table workbook that Microsoft Excel can open; it does not create a modern `.xlsx` file. No export package or database change is required.


### Report summary card amount wrapping — 17 October 2026

Adjusted the shared `StatCard` layout to prevent overflow while preserving readable amounts. The initial generic wrapping treatment broke currency values across digits and was visually poor; it has been replaced with an Assessment Roll-specific two-column layout at common screen sizes and single-line, slightly smaller currency values. The layout returns to four columns on very wide screens. The shared card supports an optional value style so other cards retain their existing appearance.
