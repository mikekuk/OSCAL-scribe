# Before production — evolving release guide

**This is a guide, not certification, a complete threat model or permission to deploy production.**
The app is still being developed and may change substantially.

The source review behind this guide references commit
[`dc08a82d1ba34dcb2ab9ab622f40ee428992c310`](https://github.com/mikekuk/OSCAL-scribe/tree/dc08a82d1ba34dcb2ab9ab622f40ee428992c310).
Hardening added after that baseline must be assessed with subsequent changes.
**Once development and integration in the work environment are complete, repeat the security review against
its exact final commit and the deployed Azure configuration.** Record that new commit and review date here or in
the release evidence. A passing build does not replace that review.

There is deliberately no enabled production pipeline/profile in this change. The loader and Terraform contain
minimum production-policy checks, but these are not the entire production security policy. Do not obtain production
approval merely by renaming `dev.json` or changing its environment label.

**Implemented hardening snapshot:** [`b6d212ce9ba8c0cf3ce03f8e7acfc581d3617764`](https://github.com/mikekuk/OSCAL-scribe/commit/b6d212ce9ba8c0cf3ce03f8e7acfc581d3617764).
This documentation follow-up names the exact code/configuration snapshot; later application changes need renewed review.

## Review the final system

- Inventory actual browser, API, identity, data, admin, publisher, deployment and network trust boundaries.
- Review all changes since the baseline, dependencies, CI permissions and effective Terraform plans.
- Verify tenant isolation, object authorization, guest policy, token lifecycle, revocation and fresh authentication
  for privileged operations. The current application trusts signed roles until token expiry.
- Reassess the SPA token-storage design, remaining escaped HTML templates and whether server-side sessions are
  appropriate. A move to cookies needs CSRF protection and a separate session threat model.
- Test the real application with representative document sizes, realistic concurrency and hostile requests.
- Confirm direct API access cannot bypass required edge controls; preserving JWT verification alone does not
  prove a future WAF is non-bypassable.

## Finish the architecture in work dev first

- Validate any private ingress/gateway, WAF or API management design before production; current dev uses public
  SWA-linked API ingress with private data services.
- Implement and test shared rate/quota controls if required. Instance-local counters are only a first layer.
- Decide whether to separate the administrative API/identity and restrict SSP delete privileges at the data layer.
- Establish independently retained, tamper-resistant audit evidence with no runtime delete/update permission.
  The current create-only audit container does not prevent fabricated new events or privileged Azure operators.
- Decide whether state storage also needs private networking and implement the bootstrap/agent changes first.
- Validate regional availability, capacity, data residency, private DNS, permitted egress and disaster recovery.

## Establish production controls

- Use production-only identities, service connections, data resources and state. Review inherited Azure grants;
  a narrow Terraform assignment does not cancel a broader manual assignment.
- Require the approved Conditional Access policy, privileged elevation, emergency access and access-review process.
  Resolve Entra/device-management licensing with the identity team.
- Prohibit demo publication and localhost redirects. Default raw browsing and permanent deletion to disabled.
- Require independent release/content/destruction approvals on protected Azure DevOps resources and protected branches.
  Restrict who can alter or bypass those protections; do not rely only on editable YAML approvals.
- Keep application deployment/publishing separate from Entra and infrastructure administration. Review directory-wide
  infrastructure Graph permissions again; ordinary deployment must not inherit them.
- Approve backup and audit retention against business requirements. Current production minimum checks require
  30-day Cosmos backup and at least 90-day logs, but company requirements may be longer or different.
- Protect data/state resources and require a reviewed removal procedure. Azure deletion locks do not stop item deletion.
- Route actionable security/availability alerts to named owners, test delivery, and size ingestion caps to avoid blind spots.
- Assign incident response, dependency patching, vulnerability triage, recovery and access-review responsibilities.

## Release evidence and stop conditions

Require an accepted [work-dev test record](work-dev.md#work-dev-acceptance-record), successful restore rehearsal,
rollback rehearsal, final dependency/security scan results, reviewed infrastructure plan, approved content provenance,
and artifact digests tied to the release commit. Recheck effective RBAC, network restrictions and authentication after deployment.

Do not release with untested private connectivity, missing data recovery, unexplained scanner findings, a shared
personal/dev/prod identity boundary, absent operational ownership, or unresolved high-impact review findings.
Document residual risks and their accountable acceptance rather than treating this guide as automatically satisfied.

Revisit this guide whenever authentication, authorization, admin features, file handling, dependencies, hosting,
networking or pipelines change. Repeat the security review after the work-dev development phase even if no checklist
item appears to have changed.
