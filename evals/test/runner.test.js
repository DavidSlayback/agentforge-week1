const test=require('node:test'); const assert=require('node:assert/strict'); const path=require('node:path'); const {runGoldenSuite}=require('../lib/runner');
const fixturePath=path.resolve(process.cwd(),'docs/agentforge/fixtures/clinical-cases.json');
const responses=()=>require('../lib/reference').referenceResponses(require(fixturePath).cases);
test('runs all seven fixtures with a passing safety gate',()=>{const report=runGoldenSuite({fixturePath,responses:responses()}); assert.equal(report.total_cases,7); assert.equal(report.passed_cases,7); assert.equal(report.critical_failures,0); assert.equal(report.gate_passed,true);});
test('fails on missing responses instead of silently dropping cases',()=>{const report=runGoldenSuite({fixturePath,responses:{}}); assert.equal(report.failed_cases,7); assert.equal(report.gate_passed,false);});
