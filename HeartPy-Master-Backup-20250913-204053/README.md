# HeartPy Master Backup

Created: Sat Sep 13 20:40:53 +03 2025

## 📁 Structure

### 💾 backups/
Contains all historical backups:
- `backup-YYYYMMDD-HHMMSS/` - Safe sync backups
- `pre-symlink-backup-YYYYMMDD-HHMMSS/` - Pre-symlink state
- `cpp-archive-YYYYMMDD-HHMMSS/` - Archived duplications

### 🔧 scripts/
Contains all management scripts:
- `safe_sync.sh` - Sync iOS ↔ Root cpp
- `rollback.sh` - Restore from backup
- `check_status.sh` - Status verification
- `symlink_solution.sh` - Apply symlink deduplication
- `clean_duplicates.sh` - Archive-based deduplication
- `organize_backups.sh` - This script

### 📸 current-state/
Snapshot of current file state:
- `cpp/` - Master C++ files
- `ios/` - iOS symlink structure
- `cpp/` - RN utilities

## 🔄 Quick Restore Commands

### Restore specific backup:
```bash
# List available backups
ls HeartPy-Master-Backup-20250913-204053/backups/

# Restore from backup
cp HeartPy-Master-Backup-20250913-204053/backups/backup-YYYYMMDD-HHMMSS/* /Users/adilyoltay/Desktop/heartpy/cpp/
```

### Restore pre-symlink state:
```bash
cd /Users/adilyoltay/Desktop/heartpy/react-native-heartpy/ios
rm heartpy_*.{h,cpp} rn_options_builder.{h,cpp}
cp HeartPy-Master-Backup-20250913-204053/backups/pre-symlink-backup-*/\* .
```

### Use scripts:
```bash
# Copy script to root and run
cp HeartPy-Master-Backup-20250913-204053/scripts/check_status.sh /Users/adilyoltay/Desktop/heartpy/
cd /Users/adilyoltay/Desktop/heartpy && ./check_status.sh
```

## 🎯 Current Architecture

**Single Source of Truth:**
- Master files: `cpp/` directory
- iOS references: symlinks to master
- Zero duplication
- Automatic sync via symlinks

## 📊 Validation Results

**MIT-BIH Clinical Validation:** 91.4% accuracy
**Build Status:** All platforms successful
**Symlink Compatibility:** Xcode-compatible
