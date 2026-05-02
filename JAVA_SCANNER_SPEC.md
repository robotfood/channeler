# Java CWE & Code Quality Scanner Spec

## Overview

Offline, open-source static analysis pipeline for Java/Quarkus microservices using two complementary tools:

- **Semgrep** — pattern-based source analysis for CWE security vulnerabilities. No compilation required.
- **PMD** — AST-based analysis for security rules, god classes, cyclomatic complexity, excessive branching, and other code quality metrics. No compilation required.

Neither tool requires the code to compile. Both run fully offline after initial setup.

---

## Goals

| Goal | Tool |
|------|------|
| CWE security scanning (injection, XSS, XXE, weak crypto, hardcoded secrets, path traversal, SSRF, deserialization) | Semgrep + PMD security ruleset |
| God class detection | PMD |
| Cyclomatic / cognitive / NPath complexity | PMD |
| Excessive branching (too many ifs, deep nesting) | PMD |
| Oversized classes and methods | PMD |
| Excessive coupling and imports | PMD |
| Error-prone patterns (empty catch, null assignment) | PMD |
| Unused code | PMD |

---

## Limitations

- No dataflow analysis across method boundaries (requires compiled bytecode tools like SpotBugs + Find Security Bugs or CodeQL)
- Quarkus-specific patterns (Panache query safety, `@PermitAll` misuse, reactive pipeline taint) are not covered by existing community rulesets — custom rules would be needed
- Higher false positive rate than bytecode tools for security findings

---

## Directory Layout (post-install)

```
/opt/scanners/
  semgrep-rules/       # github.com/returntocorp/semgrep-rules
  tob-rules/           # github.com/trailofbits/semgrep-rules
  pmd/                 # PMD binary
  rulesets/
    java-full.xml      # custom PMD ruleset
  scan.sh              # scan runner
  output/              # default output location
```

---

## Setup Script

Installs Semgrep, PMD, fetches rules, writes the PMD ruleset, and writes the scan runner. Idempotent — safe to re-run.

```bash
#!/bin/bash
set -e

# ============================================================
# JAVA CWE + QUALITY SCANNER SETUP
# Installs: Semgrep, PMD, rules, and scan runner
# ============================================================

INSTALL_DIR="/opt/scanners"
PMD_VERSION="7.10.0"
PMD_DIR="$INSTALL_DIR/pmd/pmd-bin-$PMD_VERSION"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[+]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[x]${NC} $1"; exit 1; }
section() { echo -e "\n${YELLOW}=== $1 ===${NC}"; }

# ============================================================
# PREFLIGHT
# ============================================================
section "Preflight checks"

command -v python3 &>/dev/null || error "Python 3 is required"
command -v java    &>/dev/null || error "Java 11+ is required"
command -v git     &>/dev/null || error "git is required"
command -v curl    &>/dev/null || error "curl is required"
command -v unzip   &>/dev/null || error "unzip is required"

info "Python: $(python3 --version)"
info "Java:   $(java --version 2>&1 | head -1)"

# ============================================================
# DIRECTORIES
# ============================================================
section "Creating directories"

sudo mkdir -p \
  "$INSTALL_DIR/semgrep-rules" \
  "$INSTALL_DIR/tob-rules" \
  "$INSTALL_DIR/pmd" \
  "$INSTALL_DIR/rulesets" \
  "$INSTALL_DIR/output"

sudo chown -R "$(whoami)" "$INSTALL_DIR"
info "Created $INSTALL_DIR"

# ============================================================
# SEMGREP
# ============================================================
section "Installing Semgrep"

if command -v semgrep &>/dev/null; then
  warn "Semgrep already installed: $(semgrep --version)"
else
  pip install semgrep
  info "Semgrep installed: $(semgrep --version)"
fi

section "Fetching Semgrep rules"

if [ -d "$INSTALL_DIR/semgrep-rules/.git" ]; then
  warn "semgrep-rules already cloned, pulling latest"
  git -C "$INSTALL_DIR/semgrep-rules" pull --ff-only
else
  git clone --depth=1 https://github.com/returntocorp/semgrep-rules \
    "$INSTALL_DIR/semgrep-rules"
  info "Cloned semgrep-rules"
fi

if [ -d "$INSTALL_DIR/tob-rules/.git" ]; then
  warn "tob-rules already cloned, pulling latest"
  git -C "$INSTALL_DIR/tob-rules" pull --ff-only
else
  git clone --depth=1 https://github.com/trailofbits/semgrep-rules \
    "$INSTALL_DIR/tob-rules"
  info "Cloned Trail of Bits rules"
fi

# ============================================================
# PMD
# ============================================================
section "Installing PMD $PMD_VERSION"

if [ -f "$PMD_DIR/bin/pmd" ]; then
  warn "PMD already installed at $PMD_DIR"
else
  curl -L \
    "https://github.com/pmd/pmd/releases/download/pmd_releases/$PMD_VERSION/pmd-dist-$PMD_VERSION-bin.zip" \
    -o /tmp/pmd.zip
  unzip -q /tmp/pmd.zip -d "$INSTALL_DIR/pmd"
  rm /tmp/pmd.zip
  info "PMD extracted to $PMD_DIR"
fi

PMD_BIN="$PMD_DIR/bin/pmd"

if [ ! -f /usr/local/bin/pmd ]; then
  sudo ln -s "$PMD_BIN" /usr/local/bin/pmd
  info "Symlinked pmd to /usr/local/bin/pmd"
else
  warn "/usr/local/bin/pmd already exists, skipping symlink"
fi

# ============================================================
# PMD RULESET
# ============================================================
section "Writing PMD ruleset"

cat > "$INSTALL_DIR/rulesets/java-full.xml" << 'EOF'
<?xml version="1.0"?>
<ruleset name="Java Full Scan"
  xmlns="http://pmd.sourceforge.net/ruleset/2.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://pmd.sourceforge.net/ruleset/2.0.0
    https://pmd.sourceforge.io/ruleset_2_0_0.xsd">

  <description>Security + quality rules for Java/Quarkus</description>

  <!-- ===== SECURITY (CWEs) ===== -->
  <rule ref="category/java/security.xml"/>

  <!-- ===== GOD CLASSES / SIZE ===== -->
  <rule ref="category/java/design.xml/GodClass"/>

  <rule ref="category/java/design.xml/ExcessiveClassLength">
    <properties>
      <property name="minimum" value="500"/>
    </properties>
  </rule>

  <rule ref="category/java/design.xml/ExcessiveMethodLength">
    <properties>
      <property name="minimum" value="50"/>
    </properties>
  </rule>

  <rule ref="category/java/design.xml/TooManyMethods">
    <properties>
      <property name="maxmethods" value="20"/>
    </properties>
  </rule>

  <rule ref="category/java/design.xml/TooManyFields">
    <properties>
      <property name="maxfields" value="15"/>
    </properties>
  </rule>

  <rule ref="category/java/design.xml/ExcessiveParameterList">
    <properties>
      <property name="minimum" value="5"/>
    </properties>
  </rule>

  <!-- ===== COMPLEXITY ===== -->
  <rule ref="category/java/design.xml/CyclomaticComplexity">
    <properties>
      <property name="classReportLevel" value="80"/>
      <property name="methodReportLevel" value="10"/>
    </properties>
  </rule>

  <rule ref="category/java/design.xml/NPathComplexity">
    <properties>
      <property name="reportLevel" value="200"/>
    </properties>
  </rule>

  <rule ref="category/java/design.xml/CognitiveComplexity">
    <properties>
      <property name="reportLevel" value="15"/>
    </properties>
  </rule>

  <!-- ===== TOO MANY IFS / BRANCHING ===== -->
  <rule ref="category/java/design.xml/SwitchDensity"/>
  <rule ref="category/java/design.xml/SimplifyBooleanReturns"/>
  <rule ref="category/java/design.xml/SimplifyBooleanExpressions"/>
  <rule ref="category/java/design.xml/CollapsibleIfStatements"/>

  <rule ref="category/java/design.xml/AvoidDeeplyNestedIfStmts">
    <properties>
      <property name="problemDepth" value="3"/>
    </properties>
  </rule>

  <!-- ===== COUPLING ===== -->
  <rule ref="category/java/design.xml/CouplingBetweenObjects">
    <properties>
      <property name="threshold" value="20"/>
    </properties>
  </rule>

  <rule ref="category/java/design.xml/ExcessiveImports">
    <properties>
      <property name="minimum" value="30"/>
    </properties>
  </rule>

  <!-- ===== ERROR PRONE ===== -->
  <rule ref="category/java/errorprone.xml/AvoidCatchingGenericException"/>
  <rule ref="category/java/errorprone.xml/AvoidCatchingNPE"/>
  <rule ref="category/java/errorprone.xml/EmptyCatchBlock"/>
  <rule ref="category/java/errorprone.xml/NullAssignment"/>
  <rule ref="category/java/errorprone.xml/ReturnEmptyCollectionRatherThanNull"/>

  <!-- ===== BEST PRACTICES ===== -->
  <rule ref="category/java/bestpractices.xml/AvoidReassigningParameters"/>
  <rule ref="category/java/bestpractices.xml/UnusedPrivateMethod"/>
  <rule ref="category/java/bestpractices.xml/UnusedLocalVariable"/>
  <rule ref="category/java/bestpractices.xml/UnusedPrivateField"/>

</ruleset>
EOF

info "PMD ruleset written to $INSTALL_DIR/rulesets/java-full.xml"

# ============================================================
# SCAN SCRIPT
# ============================================================
section "Writing scan script"

cat > "$INSTALL_DIR/scan.sh" << 'SCANEOF'
#!/bin/bash
set -e

INSTALL_DIR="/opt/scanners"
TARGET=${1:-.}
OUTPUT_DIR=${2:-./scan-results}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FORMAT=${3:-sarif}   # sarif | text

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[+]${NC} $1"; }
section() { echo -e "\n${YELLOW}=== $1 ===${NC}"; }

mkdir -p "$OUTPUT_DIR"

# ---- Semgrep ----
section "Semgrep — CWE security scan"

if [ "$FORMAT" = "text" ]; then
  semgrep \
    --config "$INSTALL_DIR/semgrep-rules/java/security" \
    --config "$INSTALL_DIR/tob-rules" \
    --exclude "*/test/*" \
    --exclude "*/target/*" \
    "$TARGET" \
    2>&1 | tee "$OUTPUT_DIR/semgrep-$TIMESTAMP.txt"
else
  semgrep \
    --config "$INSTALL_DIR/semgrep-rules/java/security" \
    --config "$INSTALL_DIR/tob-rules" \
    --output "$OUTPUT_DIR/semgrep-$TIMESTAMP.sarif" \
    --sarif \
    --exclude "*/test/*" \
    --exclude "*/target/*" \
    "$TARGET"
  info "Semgrep results: $OUTPUT_DIR/semgrep-$TIMESTAMP.sarif"
fi

# ---- PMD ----
section "PMD — security + quality scan"

if [ "$FORMAT" = "text" ]; then
  pmd check \
    -d "$TARGET" \
    -R "$INSTALL_DIR/rulesets/java-full.xml" \
    -f text \
    --no-fail-on-violation \
    --exclude "*/test/*" \
    2>&1 | tee "$OUTPUT_DIR/pmd-$TIMESTAMP.txt"
else
  pmd check \
    -d "$TARGET" \
    -R "$INSTALL_DIR/rulesets/java-full.xml" \
    -f sarif \
    --report-file "$OUTPUT_DIR/pmd-$TIMESTAMP.sarif" \
    --no-fail-on-violation \
    --exclude "*/test/*"
  info "PMD results: $OUTPUT_DIR/pmd-$TIMESTAMP.sarif"
fi

echo ""
echo "================================================"
echo " Scan complete"
echo " Target:  $TARGET"
echo " Results: $OUTPUT_DIR"
echo "================================================"
SCANEOF

chmod +x "$INSTALL_DIR/scan.sh"
info "Scan script written to $INSTALL_DIR/scan.sh"

# ============================================================
# VERIFY
# ============================================================
section "Verifying installation"

semgrep --version && info "Semgrep OK"
pmd --version      && info "PMD OK"

[ -d "$INSTALL_DIR/semgrep-rules/java/security" ] \
  && info "Semgrep java/security rules OK" \
  || warn "Semgrep java/security rules not found — check clone"

[ -d "$INSTALL_DIR/tob-rules" ] \
  && info "Trail of Bits rules OK" \
  || warn "Trail of Bits rules not found — check clone"

[ -f "$INSTALL_DIR/rulesets/java-full.xml" ] \
  && info "PMD ruleset OK"

echo ""
echo "================================================"
echo " Setup complete!"
echo ""
echo " Usage:"
echo "   # SARIF output (default, use with VS Code SARIF viewer)"
echo "   $INSTALL_DIR/scan.sh /path/to/project ./results"
echo ""
echo "   # Human-readable text output"
echo "   $INSTALL_DIR/scan.sh /path/to/project ./results text"
echo "================================================"
```

---

## PMD Ruleset Reference

The ruleset at `/opt/scanners/rulesets/java-full.xml` covers:

| Category | Rules |
|----------|-------|
| Security | Full `category/java/security.xml` |
| God class | `GodClass` |
| Class size | `ExcessiveClassLength` (>500 lines), `TooManyMethods` (>20), `TooManyFields` (>15) |
| Method size | `ExcessiveMethodLength` (>50 lines), `ExcessiveParameterList` (>5 params) |
| Complexity | `CyclomaticComplexity` (method >10), `NPathComplexity` (>200), `CognitiveComplexity` (>15) |
| Branching | `AvoidDeeplyNestedIfStmts` (depth >3), `CollapsibleIfStatements`, `SimplifyBooleanReturns`, `SimplifyBooleanExpressions`, `SwitchDensity` |
| Coupling | `CouplingBetweenObjects` (>20), `ExcessiveImports` (>30) |
| Error prone | Empty catch, catching NPE, null assignment, returning null collections |
| Best practices | Unused fields/methods/variables, reassigning parameters |

---

## Running a Scan

```bash
# Install everything (once)
chmod +x setup.sh
sudo ./setup.sh

# Scan — SARIF output (default)
/opt/scanners/scan.sh /path/to/quarkus-project ./results

# Scan — human-readable text
/opt/scanners/scan.sh /path/to/quarkus-project ./results text
```

Output files are timestamped:

```
results/
  semgrep-20260502-143000.sarif   # or .txt
  pmd-20260502-143000.sarif       # or .txt
```

SARIF files can be opened directly in VS Code with the **SARIF Viewer** extension, which annotates findings inline in source files.

---

## Extending the Rules

### Add a Semgrep rule

Create a `.yaml` file anywhere and pass it with `--config`:

```yaml
rules:
  - id: quarkus-panache-raw-query
    pattern: |
      $X.find($QUERY, ...)
    pattern-not: |
      $X.find("...", ...)
    message: Possible Panache query injection — use parameterized queries (CWE-89)
    languages: [java]
    severity: ERROR
    metadata:
      cwe: "CWE-89: SQL Injection"
```

### Add a PMD rule (XPath)

Add to `java-full.xml`:

```xml
<rule name="NoMD5Usage"
      language="java"
      message="MD5 is cryptographically weak (CWE-327)"
      class="net.sourceforge.pmd.lang.rule.xpath.XPathRule">
  <properties>
    <property name="xpath">
      <value>
        //PrimaryPrefix/Name[@Image='MessageDigest']
          [following::StringLiteral[@Image='"MD5"']]
      </value>
    </property>
  </properties>
</rule>
```

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Python | 3.8+ |
| Java | 11+ |
| git | any |
| curl | any |
| unzip | any |

---

## Full Scripts

### setup.sh

Installs Semgrep, PMD, fetches all rules, writes the PMD ruleset, and writes `scan.sh`. Idempotent — safe to re-run.

```bash
#!/bin/bash
set -e

INSTALL_DIR="/opt/scanners"
PMD_VERSION="7.10.0"
PMD_DIR="$INSTALL_DIR/pmd/pmd-bin-$PMD_VERSION"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[+]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[x]${NC} $1"; exit 1; }
section() { echo -e "\n${YELLOW}=== $1 ===${NC}"; }

section "Preflight checks"

command -v python3 &>/dev/null || error "Python 3 is required"
command -v java    &>/dev/null || error "Java 11+ is required"
command -v git     &>/dev/null || error "git is required"
command -v curl    &>/dev/null || error "curl is required"
command -v unzip   &>/dev/null || error "unzip is required"

info "Python: $(python3 --version)"
info "Java:   $(java --version 2>&1 | head -1)"

section "Creating directories"

sudo mkdir -p \
  "$INSTALL_DIR/semgrep-rules" \
  "$INSTALL_DIR/tob-rules" \
  "$INSTALL_DIR/pmd" \
  "$INSTALL_DIR/rulesets" \
  "$INSTALL_DIR/output"

sudo chown -R "$(whoami)" "$INSTALL_DIR"
info "Created $INSTALL_DIR"

section "Installing Semgrep"

if command -v semgrep &>/dev/null; then
  warn "Semgrep already installed: $(semgrep --version)"
else
  pip install semgrep
  info "Semgrep installed: $(semgrep --version)"
fi

section "Fetching Semgrep rules"

if [ -d "$INSTALL_DIR/semgrep-rules/.git" ]; then
  warn "semgrep-rules already cloned, pulling latest"
  git -C "$INSTALL_DIR/semgrep-rules" pull --ff-only
else
  git clone --depth=1 https://github.com/returntocorp/semgrep-rules \
    "$INSTALL_DIR/semgrep-rules"
  info "Cloned semgrep-rules"
fi

if [ -d "$INSTALL_DIR/tob-rules/.git" ]; then
  warn "tob-rules already cloned, pulling latest"
  git -C "$INSTALL_DIR/tob-rules" pull --ff-only
else
  git clone --depth=1 https://github.com/trailofbits/semgrep-rules \
    "$INSTALL_DIR/tob-rules"
  info "Cloned Trail of Bits rules"
fi

section "Installing PMD $PMD_VERSION"

if [ -f "$PMD_DIR/bin/pmd" ]; then
  warn "PMD already installed at $PMD_DIR"
else
  curl -L \
    "https://github.com/pmd/pmd/releases/download/pmd_releases/$PMD_VERSION/pmd-dist-$PMD_VERSION-bin.zip" \
    -o /tmp/pmd.zip
  unzip -q /tmp/pmd.zip -d "$INSTALL_DIR/pmd"
  rm /tmp/pmd.zip
  info "PMD extracted to $PMD_DIR"
fi

if [ ! -f /usr/local/bin/pmd ]; then
  sudo ln -s "$PMD_DIR/bin/pmd" /usr/local/bin/pmd
  info "Symlinked pmd to /usr/local/bin/pmd"
else
  warn "/usr/local/bin/pmd already exists, skipping symlink"
fi

section "Writing PMD ruleset"

cat > "$INSTALL_DIR/rulesets/java-full.xml" << 'EOF'
<?xml version="1.0"?>
<ruleset name="Java Full Scan"
  xmlns="http://pmd.sourceforge.net/ruleset/2.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://pmd.sourceforge.net/ruleset/2.0.0
    https://pmd.sourceforge.io/ruleset_2_0_0.xsd">

  <description>Security + quality rules for Java/Quarkus</description>

  <rule ref="category/java/security.xml"/>

  <rule ref="category/java/design.xml/GodClass"/>

  <rule ref="category/java/design.xml/ExcessiveClassLength">
    <properties><property name="minimum" value="500"/></properties>
  </rule>

  <rule ref="category/java/design.xml/ExcessiveMethodLength">
    <properties><property name="minimum" value="50"/></properties>
  </rule>

  <rule ref="category/java/design.xml/TooManyMethods">
    <properties><property name="maxmethods" value="20"/></properties>
  </rule>

  <rule ref="category/java/design.xml/TooManyFields">
    <properties><property name="maxfields" value="15"/></properties>
  </rule>

  <rule ref="category/java/design.xml/ExcessiveParameterList">
    <properties><property name="minimum" value="5"/></properties>
  </rule>

  <rule ref="category/java/design.xml/CyclomaticComplexity">
    <properties>
      <property name="classReportLevel" value="80"/>
      <property name="methodReportLevel" value="10"/>
    </properties>
  </rule>

  <rule ref="category/java/design.xml/NPathComplexity">
    <properties><property name="reportLevel" value="200"/></properties>
  </rule>

  <rule ref="category/java/design.xml/CognitiveComplexity">
    <properties><property name="reportLevel" value="15"/></properties>
  </rule>

  <rule ref="category/java/design.xml/SwitchDensity"/>
  <rule ref="category/java/design.xml/SimplifyBooleanReturns"/>
  <rule ref="category/java/design.xml/SimplifyBooleanExpressions"/>
  <rule ref="category/java/design.xml/CollapsibleIfStatements"/>

  <rule ref="category/java/design.xml/AvoidDeeplyNestedIfStmts">
    <properties><property name="problemDepth" value="3"/></properties>
  </rule>

  <rule ref="category/java/design.xml/CouplingBetweenObjects">
    <properties><property name="threshold" value="20"/></properties>
  </rule>

  <rule ref="category/java/design.xml/ExcessiveImports">
    <properties><property name="minimum" value="30"/></properties>
  </rule>

  <rule ref="category/java/errorprone.xml/AvoidCatchingGenericException"/>
  <rule ref="category/java/errorprone.xml/AvoidCatchingNPE"/>
  <rule ref="category/java/errorprone.xml/EmptyCatchBlock"/>
  <rule ref="category/java/errorprone.xml/NullAssignment"/>
  <rule ref="category/java/errorprone.xml/ReturnEmptyCollectionRatherThanNull"/>

  <rule ref="category/java/bestpractices.xml/AvoidReassigningParameters"/>
  <rule ref="category/java/bestpractices.xml/UnusedPrivateMethod"/>
  <rule ref="category/java/bestpractices.xml/UnusedLocalVariable"/>
  <rule ref="category/java/bestpractices.xml/UnusedPrivateField"/>

</ruleset>
EOF

info "PMD ruleset written"

section "Writing scan script"

cat > "$INSTALL_DIR/scan.sh" << 'SCANEOF'
#!/bin/bash
set -e

INSTALL_DIR="/opt/scanners"
TARGET=${1:-.}
OUTPUT_DIR=${2:-./scan-results}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FORMAT=${3:-sarif}

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[+]${NC} $1"; }
section() { echo -e "\n${YELLOW}=== $1 ===${NC}"; }

mkdir -p "$OUTPUT_DIR"

section "Semgrep — CWE security scan"

if [ "$FORMAT" = "text" ]; then
  semgrep \
    --config "$INSTALL_DIR/semgrep-rules/java/security" \
    --config "$INSTALL_DIR/tob-rules" \
    --exclude "*/test/*" --exclude "*/target/*" \
    "$TARGET" 2>&1 | tee "$OUTPUT_DIR/semgrep-$TIMESTAMP.txt"
else
  semgrep \
    --config "$INSTALL_DIR/semgrep-rules/java/security" \
    --config "$INSTALL_DIR/tob-rules" \
    --output "$OUTPUT_DIR/semgrep-$TIMESTAMP.sarif" --sarif \
    --exclude "*/test/*" --exclude "*/target/*" \
    "$TARGET"
  info "Semgrep results: $OUTPUT_DIR/semgrep-$TIMESTAMP.sarif"
fi

section "PMD — security + quality scan"

if [ "$FORMAT" = "text" ]; then
  pmd check \
    -d "$TARGET" \
    -R "$INSTALL_DIR/rulesets/java-full.xml" \
    -f text --no-fail-on-violation \
    --exclude "*/test/*" \
    2>&1 | tee "$OUTPUT_DIR/pmd-$TIMESTAMP.txt"
else
  pmd check \
    -d "$TARGET" \
    -R "$INSTALL_DIR/rulesets/java-full.xml" \
    -f sarif --report-file "$OUTPUT_DIR/pmd-$TIMESTAMP.sarif" \
    --no-fail-on-violation \
    --exclude "*/test/*"
  info "PMD results: $OUTPUT_DIR/pmd-$TIMESTAMP.sarif"
fi

echo ""
echo "================================================"
echo " Scan complete"
echo " Target:  $TARGET"
echo " Results: $OUTPUT_DIR"
echo "================================================"
SCANEOF

chmod +x "$INSTALL_DIR/scan.sh"
info "Scan script written to $INSTALL_DIR/scan.sh"

section "Verifying installation"

semgrep --version && info "Semgrep OK"
pmd --version      && info "PMD OK"

[ -d "$INSTALL_DIR/semgrep-rules/java/security" ] \
  && info "Semgrep java/security rules OK" \
  || warn "Semgrep java/security rules not found — check clone"

[ -d "$INSTALL_DIR/tob-rules" ] \
  && info "Trail of Bits rules OK" \
  || warn "Trail of Bits rules not found — check clone"

[ -f "$INSTALL_DIR/rulesets/java-full.xml" ] && info "PMD ruleset OK"

echo ""
echo "================================================"
echo " Setup complete!"
echo " Run scans with: $INSTALL_DIR/scan.sh /path/to/project ./results"
echo "================================================"
```

---

### scan.sh

The scan runner written by `setup.sh` — shown here standalone for reference.

```bash
#!/bin/bash
set -e

INSTALL_DIR="/opt/scanners"
TARGET=${1:-.}
OUTPUT_DIR=${2:-./scan-results}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FORMAT=${3:-sarif}   # sarif | text

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[+]${NC} $1"; }
section() { echo -e "\n${YELLOW}=== $1 ===${NC}"; }

mkdir -p "$OUTPUT_DIR"

section "Semgrep — CWE security scan"

if [ "$FORMAT" = "text" ]; then
  semgrep \
    --config "$INSTALL_DIR/semgrep-rules/java/security" \
    --config "$INSTALL_DIR/tob-rules" \
    --exclude "*/test/*" --exclude "*/target/*" \
    "$TARGET" 2>&1 | tee "$OUTPUT_DIR/semgrep-$TIMESTAMP.txt"
else
  semgrep \
    --config "$INSTALL_DIR/semgrep-rules/java/security" \
    --config "$INSTALL_DIR/tob-rules" \
    --output "$OUTPUT_DIR/semgrep-$TIMESTAMP.sarif" --sarif \
    --exclude "*/test/*" --exclude "*/target/*" \
    "$TARGET"
  info "Semgrep results: $OUTPUT_DIR/semgrep-$TIMESTAMP.sarif"
fi

section "PMD — security + quality scan"

if [ "$FORMAT" = "text" ]; then
  pmd check \
    -d "$TARGET" \
    -R "$INSTALL_DIR/rulesets/java-full.xml" \
    -f text --no-fail-on-violation \
    --exclude "*/test/*" \
    2>&1 | tee "$OUTPUT_DIR/pmd-$TIMESTAMP.txt"
else
  pmd check \
    -d "$TARGET" \
    -R "$INSTALL_DIR/rulesets/java-full.xml" \
    -f sarif --report-file "$OUTPUT_DIR/pmd-$TIMESTAMP.sarif" \
    --no-fail-on-violation \
    --exclude "*/test/*"
  info "PMD results: $OUTPUT_DIR/pmd-$TIMESTAMP.sarif"
fi

echo ""
echo "================================================"
echo " Scan complete"
echo " Target:  $TARGET"
echo " Results: $OUTPUT_DIR"
echo "================================================"
```
