# Control and component workspace

The SSP starts with a local **System** component (`type: this-system`). Simple systems can keep all implementation here. Larger systems can add components such as Windows servers, Linux servers or a database service using the small **+** button on **Components**. These components exist in the SSP only; adding one does not create or publish a component-definition file.

Select approved published components in the same page. A selected component imports its statement implementations, assigned to that component. Imported sources are blue. Local components and imported components coexist in the SSP, and component names are separate from implementation statuses.

## Find and edit implementations

**Controls / Implementation** shows one expandable card per baseline control. Within each card, expand the component implementation you want to edit, then its statement sections. Each component has its own narrative, section status and remarks. The shared requirement text stays visible above its implementation.

**Find controls** searches titles, statement text and resolved parameter values. A control ID such as `IR-5` or `IR-05` matches that control only; cross-references inside other controls do not match an ID search. **Control group** and **Component view** narrow the results further. All three filters work together, with a count and an empty-state message. The parent control completion always includes all its assigned components, even when the component view hides some panels.

**Expand all** opens visible control cards; **Collapse all** closes their contents. Open cards, filters and selected controls survive tab changes within the current plan. Selecting a different plan clears them. Control selection persists across filters; the selection count includes selected controls that are currently hidden.

## Copy and move a subset of controls

1. Add your destination components under **Components**.
2. In **Controls / Implementation**, tick the controls to transfer.
3. Set **From component** and **To component**.
4. Choose **Copy selected** or **Move selected**.
5. Expand the destination component's implementation to tailor its narrative and statuses, then save a revision.

For example, move selected controls from System to Windows servers. Copy that subset from Windows servers to Linux servers. System retains the controls not selected. Windows and Linux now have independent implementation entries for the copied controls, so updating Linux does not change Windows.

Copy keeps the source; move removes only the source component's implementation entries. Both preserve narratives, section statuses and remarks in the destination. Copies receive new implementation UUIDs and remapped internal references; moves retain UUIDs so existing references remain valid. Neither operation duplicates the baseline control or its statement identifier. Copying a complete implementation carries its status across: review it for the destination before treating the copied text as accurate.

Imported contributions can be copied to a local component, but cannot be moved or used as copy/move destinations. Their original assignment stays with the imported component. Copies retain source lineage while becoming independently editable local implementations.

A transfer is rejected if any selected control is missing from the source or already assigned to the destination. The entire batch is checked first; a failure changes nothing and never overwrites existing destination work. Clear selection after an error if you want to choose a different subset.

## Delete components and redundant control assignments

The add-component form is hidden initially. Use the small **+** button to open it below the existing components; it closes after adding a component.

**Delete component** is available for additional local components. System and imported component originals are protected. Unique statement implementations are moved back to System, keeping their UUIDs, narratives and statuses. If another component already has a statement assignment, its existing work is retained without being overwritten. An empty local component can be deleted directly.

Inside a local component’s control panel, **Delete control from this component** removes only that assignment. Every section covered by that assignment must also be assigned to another component, even if that other implementation is still Planned or Partial; otherwise the operation is rejected without changing anything. Use Move when transferring sole responsibility. The baseline control and other components’ implementations remain in the SSP. These edits are saved as a new revision; historical revisions remain available.

## Standard status and source colour

The status selector contains only OSCAL implementation states:

| UI label | OSCAL value | Meaning |
| --- | --- | --- |
| Planned | `planned` | Implementation remains to be documented or completed |
| Partial | `partial` | Some implementation work remains |
| Implemented | `implemented` | Implementation is complete |
| Alternative | `alternative` | An alternative is used; explain it in remarks |
| Not applicable | `not-applicable` | Not applicable to this component; explain why |

Blue identifies an **imported source**, independently of its status. There is no Inherited status. Imported control/component panels and sections remain blue; their status badges still say Planned, Partial, Implemented, Alternative or Not applicable. Other status colours are red, amber, green, yellow and grey respectively.

Every assigned component must complete its implementation before the statement is complete. A Windows implementation marked Implemented does not hide a Linux implementation still marked Planned or Partial. This rule also applies to imported components. A published partial contribution stays partial until the SSP author records completion of that component's actual in-system implementation. Completing only the System entry does not override another component's partial entry.

A control is complete when all required statements are complete across their assigned components. A mix of complete states rolls up to Implemented; all Alternative or all Not applicable retains that state. These roll-ups are application summaries, not additional OSCAL status values or verification of effectiveness.

## Import and adaptation

Imports match exact `statement-id` values. A control-wide narrative never implies coverage of unpublished statements. A published statement without an explicit status is treated as an implementation declaration; explicit Partial or Planned declarations retain their meaning. On import, every published statement is assigned to its source component and removed from System, including Partial and Planned statements. Unpublished sections remain on System. When all of a control’s sections are imported, its System control assignment is removed too. This happens on selection; viewing or saving does not remove later local assignments.

Import is performed when the component is selected. Viewing or saving the SSP does not repeatedly import the template, restore moved work or overwrite edits. Authors may adapt the imported component's implementation narrative and status in this SSP. The original published component-definition is unchanged, and the imported source remains identified in blue. Deselecting a published component removes its SSP contributions; local copies and unrelated local implementations remain. Unassigned sections fall back to System. Historical saved revisions remain unchanged.

The component-definition model does not provide the SSP's `by-components` status field on published statements. The demo publisher declares only Implemented coverage in component-definition statement properties. Uncovered sections are omitted and remain assigned to System as Planned; a parent control can therefore be Partial without publishing any Partial subsections. Import converts these declarations to standard SSP status fields; status properties are not copied into the SSP.

## OSCAL representation

There is one `control-implementation.implemented-requirements` entry per baseline control and one statement entry per statement ID. Multiple implementations appear as `by-components` entries under the requirement and its statements. Each entry references an SSP `system-implementation.components[].uuid` using `component-uuid` and contains its own description, `implementation-status.state` and optional remarks.

Local components have their own UUIDs, types and lifecycle status inside the SSP. Imported components retain their component identity, and newly imported components/statements have standard `links` with `rel: imported-from` pointing to the source document/component or statement. A local copy changes the lineage relation to `derived-from`. Source document UUIDs identify the definitions in the pinned content release.

No `implementation-status`, `implementation-component`, `status-tracking` or `completion-decision` properties are written to SSP requirements or statements. Older status properties are migrated into native `by-components` fields when edited or saved; unrelated properties remain intact. Clearing a narrative does not delete the status: a non-empty placeholder preserves OSCAL's required description field.

This follows the [NIST SSP model](https://pages.nist.gov/OSCAL/learn/concepts/layer/implementation/ssp/): control satisfaction may be recorded for a whole system or individual implemented components. Importing a component-definition is source reuse; it is not automatically OSCAL leveraged-authorization inheritance. The editor does not invent leveraged authorization, provided or inherited responsibility references.

## Maintenance and verification

`src/shared/implementation.ts` owns assignment, copy/move, native statuses, migration and component/role cleanup. The transfer function validates the whole batch before mutation and renews copied UUIDs plus internal references. `src/web/control-view.ts` renders independent component panels and search matching. `src/web/main.ts` binds controls using both control IDs and component UUIDs, so edits cannot leak between Windows and Linux panels.

Tests cover independent copies, moves, destination conflicts, invalid batches, imported-source protection, strict completion across components, native status persistence, migration, read-only rendering, search, OSCAL schema/reference validity and the complete worked example. Existing baseline ODP values and imported profile text remain unchanged.
