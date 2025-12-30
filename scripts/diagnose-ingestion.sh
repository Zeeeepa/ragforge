#!/bin/bash
# Diagnostic script for RagForge ingestion blocking issues

LOG="${1:-/home/luciedefraiteur/.ragforge/logs/daemon.log}"

echo "=== RagForge Ingestion Diagnostic ==="
echo "Log file: $LOG"
echo "Current time: $(date)"
echo ""

# Extract last log timestamp
last_ts=$(tail -1 "$LOG" | grep -oP '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}')
echo "Last log entry: $last_ts"
echo ""

# Count different log types
scheduled=$(grep -c "📄 \[" "$LOG" 2>/dev/null || echo 0)
read_files=$(grep -c "📖 Read" "$LOG" 2>/dev/null || echo 0)
parsed=$(grep -c "📊 Parsed" "$LOG" 2>/dev/null || echo 0)
done_files=$(grep -c "✅ Done" "$LOG" 2>/dev/null || echo 0)
errors=$(grep -c -i "error\|failed\|warn" "$LOG" 2>/dev/null || echo 0)

echo "=== Counters ==="
echo "Scheduled (📄): $scheduled"
echo "Read (📖):      $read_files"
echo "Parsed (📊):    $parsed"
echo "Done (✅):      $done_files"
echo "Errors/Warns:   $errors"
echo ""

# Find files scheduled but not read (blocking before read)
echo "=== Files Scheduled but NOT Read (blocking) ==="
scheduled_files=$(grep "📄 \[" "$LOG" | tail -20 | sed 's/.*] //')
blocked_count=0
for f in $scheduled_files; do
    if ! grep -qF "📖 Read $f" "$LOG" 2>/dev/null; then
        echo "  BLOCKED: $(basename "$f")"
        ((blocked_count++))
    fi
done
if [ $blocked_count -eq 0 ]; then
    echo "  (none)"
fi
echo ""

# Find files read but not completed (blocking during parse)
echo "=== Files Read but NOT Completed (stuck in parser) ==="
stuck_count=0
grep "📖 Read" "$LOG" | tail -20 | while read line; do
    file=$(echo "$line" | sed 's/.*📖 Read //' | sed 's/ (.*//')
    fname=$(basename "$file")
    # Check for various completion patterns
    if ! grep -qF "📊 Parsed $file" "$LOG" 2>/dev/null; then
        if ! grep -qF "✅ Done: $file" "$LOG" 2>/dev/null; then
            if ! grep -qF "🔹 MD: done $file" "$LOG" 2>/dev/null; then
                # Skip known non-parsed files
                case "$fname" in
                    *.json|*.lock) ;;
                    *) echo "  STUCK: $fname" ;;
                esac
            fi
        fi
    fi
done
echo ""

# Show last 10 log entries
echo "=== Last 10 Log Entries ==="
tail -10 "$LOG"
echo ""

# Check if daemon is running
echo "=== Daemon Status ==="
if lsof -ti:6969 > /dev/null 2>&1; then
    echo "Daemon is RUNNING on port 6969"
    echo "PIDs: $(lsof -ti:6969 | tr '\n' ' ')"
else
    echo "Daemon is NOT running"
fi
