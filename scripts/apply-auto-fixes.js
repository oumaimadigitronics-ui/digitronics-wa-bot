#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: node apply-auto-fixes.js <report.json>');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

if (!report.autoFixes || report.autoFixes.length === 0) {
  console.log('No auto-fixes to apply');
  process.exit(0);
}

console.log(`Applying ${report.autoFixes.length} auto-fixes...`);

for (const fix of report.autoFixes) {
  if (fix.type === 'add_intent_pattern') {
    const filePath = fix.file;
    
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      
      // Add new intent function before the last export
      const insertPoint = content.lastIndexOf('export {');
      if (insertPoint >= 0) {
        content = content.slice(0, insertPoint) + fix.code + '\n\n' + content.slice(insertPoint);
        
        // Add to exports
        const exportMatch = content.match(/export \{([^}]+)\}/);
        if (exportMatch) {
          const exports = exportMatch[1].trim();
          // Add comma only if there are existing exports
          const separator = exports.length > 0 ? ',\n  ' : '\n  ';
          const newExports = exports + separator + fix.intentName;
          content = content.replace(exportMatch[0], `export {${newExports}}`);
        }
        
        fs.writeFileSync(filePath, content);
        console.log(`✅ Added ${fix.intentName} to ${filePath}`);
      }
    }
  }
}

console.log('Auto-fixes applied successfully!');
