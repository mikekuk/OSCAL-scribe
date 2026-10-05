# Control workspace

Open **Controls / Implementation** to see the profile's controls as expandable cards. Click a card to open it, then expand individual sections. **Expand all** opens the visible control cards; **Collapse all** closes their contents. Open cards and filters survive tab changes and saves within the current plan.

**Find controls** searches control IDs, titles, requirement text and resolved profile parameter values. **Control group** filters by catalog group (for example Audit and Accountability). Both filters apply together. A count and empty-state message show the result.

## Status and colour

Each statement section has a status selector. Status labels accompany every colour:

| Status | Colour | Completion meaning |
| --- | --- | --- |
| Not set | Red | No implementation decision recorded |
| Partial | Amber | Work remains |
| Implemented | Green | System implementation complete |
| Alternative | Yellow | Alternative implementation; explain it in section remarks |
| N/A | Grey | Not applicable; explain why in section remarks |
| Implemented by component | Blue | Selected published component explicitly declares full coverage |

The control is partial while any section is incomplete and at least one has a decision. All unset sections produce a red control. When every section is implemented, alternative or N/A, the control is complete. A mix of complete statuses is green; all component-delivered sections are blue, all alternative sections yellow, and all N/A sections grey. Section cards keep their own colours.

**Control completion** normally uses **Automatic from sections**. Choose **Partial — further work remains** to retain an outstanding-work decision. Once all sections are complete, **Implemented — completion confirmed** lets you override that partial decision. Reopening any section removes a prior completion confirmation. These are documentation decisions, not automated verification of control effectiveness.

Existing SSPs with only a whole-control status retain that decision until section tracking starts. Their section counts show the work still to be recorded.

## Component contributions

Select a shared service under **Components**. Published full or partial coverage is brought into sections without replacing an explicit user section decision. A publisher's statement-specific status takes priority over its whole-control status. Narrative-only or unspecified coverage is treated as partial, so selecting a component cannot silently certify a control.

Read **Published component contributions** inside the control card. Record system-specific implementation separately. When the system has completed the remaining work for a partial contribution, choose **Implemented** for the relevant section. The published component text remains unchanged. Removing a component clears its references and resets section decisions that depended on it; independent system decisions remain.

Profile ODP values remain visible inside the requirement text. The SSP parameter-assignment editor is removed. Existing SSP parameter values are preserved in saved/exported documents.

## OSCAL representation and maintenance

Section decisions are stored in statement `props` using the `https://oscal-scribe.example/ns` namespace. Standard implementation-state values are used; unset is represented as `planned`. Component identity is recorded separately in `implementation-component`, with a corresponding `by-components` entry and OSCAL `implementation-status`. The overall requirement status is saved with the section roll-up. Blue is a presentation of implemented component coverage, not an additional OSCAL state.

`src/shared/implementation.ts` owns status roll-up, component reference cleanup and role cleanup. `src/web/control-view.ts` renders the cards and provides the shared filtering predicate. Tests cover OSCAL validity, saved status transitions, partial/full component coverage, filtering, role deletion and custom-role attestation. Keep these rules shared rather than duplicating them in DOM handlers.
