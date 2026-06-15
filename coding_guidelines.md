# Coding Guidelines & Development Process

Dieses Dokument legt die grundlegenden Vereinbarungen für die Zusammenarbeit und Entwicklung in diesem Repository fest.

## 1. User Story-basierte Entwicklung (User Story Driven Development)

* **Kein Feature ohne User Story:** Für jedes zu entwickelnde Feature muss zwingend eine entsprechende User Story vorliegen.
* **Sprachregelung:** Alle User Stories und die dazugehörigen Akzeptanzkriterien müssen **grundsätzlich auf Englisch** verfasst sein.
* **Ablageort:** Die Anforderungen und User Stories werden direkt in diesem GitHub-Repository hinterlegt und gepflegt.

---

## 2. Struktur einer User Story

Jede User Story sollte folgendem Standard-Template folgen:

```markdown
# US-[ID]: [Story Title]

## Description
**As a** [role]  
**I want to** [action/feature]  
**So that** [benefit/value]

## Acceptance Criteria

### Functional Requirements
- [ ] [Functional Criterion 1]
- [ ] [Functional Criterion 2]

### Non-Functional Requirements
- [ ] [Non-Functional Criterion 1] (e.g., Performance, Security, Usability)
```

---

## 3. Akzeptanzkriterien (Acceptance Criteria)

Die Akzeptanzkriterien müssen klar strukturiert sein und werden unterteilt in:
1. **Functional Requirements (Funktionale Anforderungen):** Was das System tun soll (Verhalten, Logik, Workflows).
2. **Non-Functional Requirements (Nicht-funktionale Anforderungen):** Wie das System es tun soll (Performance, Sicherheit, Barrierefreiheit, Design-Vorgaben, etc.).

---

## 4. Git-Workflow & Branching-Modell

* **Feature Branches:** Für jede User Story wird ein eigener Branch erstellt und genutzt (z. B. `feature/US-[ID]-[kurzbeschreibung]`).
* **Automatisierte Tests:** Vor dem Merge muss so weit wie möglich automatisiert getestet werden (z. B. über automatisierte Test-Suiten oder CI/CD-Pipelines), um sicherzustellen, dass die Anforderungen korrekt und fehlerfrei umgesetzt wurden.
* **Merge & Abschluss:** Nach erfolgreicher Verifikation wird der Branch gemergt und die User Story im Repository (z. B. GitHub Issues oder GitHub Project) als abgeschlossen markiert/geschlossen.

---

## 5. Dokumentation & Changelog (GitHub als Single Source of Truth)

* **GitHub als führendes System:** Das GitHub-Repository ist immer die führende Quelle für den aktuellen Projektstand.
* **Aktualität der README.md:** Bei der Implementierung neuer Features muss die `README.md` des Projekts sofort aktualisiert werden, damit sie den aktuellen Stand des Projekts nach außen hin korrekt repräsentiert. Alle neuen Features müssen dort erfasst und verständlich beschrieben sein.
* **Changelog-Pflicht:** Jede Änderung bzw. jedes neue Feature muss in einer `CHANGELOG.md` dokumentiert werden. Der Changelog listet chronologisch auf, was hinzugefügt, geändert oder behoben wurde (z. B. nach dem Prinzip von *Keep a Changelog*).

---

## 6. Definition of Done (DoD)

Eine User Story gilt erst dann als abgeschlossen ("Done"), wenn alle Punkte dieser Checkliste erfüllt sind:

- [ ] **Akzeptanzkriterien erfüllt:** Alle funktionalen und nicht-funktionalen Akzeptanzkriterien der Story sind erfolgreich umgesetzt.
- [ ] **Tests erfolgreich:** Automatisierte Tests decken die neue Funktionalität ab und laufen lokal sowie in der CI-Pipeline fehlerfrei durch.
- [ ] **Dokumentation aktualisiert:** Die `README.md` beschreibt die neuen Features und Änderungen.
- [ ] **Changelog gepflegt:** Die Änderungen wurden in der `CHANGELOG.md` nachgetragen.
- [ ] **Code-Review & Merge:** Der Feature-Branch wurde erfolgreich in den Haupt-Branch gemergt.
- [ ] **Story geschlossen:** Das Ticket bzw. die User Story im Repository ist geschlossen.



