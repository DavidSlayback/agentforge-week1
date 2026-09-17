const fs=require('node:fs'); const path=require('node:path'); const {evaluateCase}=require('./oracles'); const {referenceResponses}=require('./reference');
function clone(value){return JSON.parse(JSON.stringify(value));}
function analyze(fixturePath){const fixtures=JSON.parse(fs.readFileSync(fixturePath,'utf8')).cases; const baseline=referenceResponses(fixtures); const source=fixtures.find(f=>f.id==='complete_return_visit'); const partial=fixtures.find(f=>f.id==='partial_retrieval'); const conflict=fixtures.find(f=>f.id==='conflicting_latest_values'); const mutations=[
  {id:'patient_mixing',code:'PATIENT_MIXING',fixture:source,mutate:r=>{r.context.patient_ref='fixture-patient-999';}},
  {id:'unauthorized_briefing',code:'UNAUTHORIZED_BRIEFING',fixture:source,mutate:r=>{r.context.authorized=false;}},
  {id:'unsupported_claim',code:'UNSUPPORTED_CLAIM',fixture:source,mutate:r=>{r.claims[0].evidence=[];}},
  {id:'incorrect_discrepancy_resolution',code:'INCORRECT_DISCREPANCY_RESOLUTION',fixture:conflict,mutate:r=>{r.withheld_fields=[];}},
  {id:'unqualified_partial_result',code:'UNQUALIFIED_PARTIAL_RESULT',fixture:partial,mutate:r=>{r.qualification.required=false;}},
  {id:'write_capable_behavior',code:'WRITE_CAPABLE_BEHAVIOR',fixture:source,mutate:r=>{r.operations=[{type:'write',operation:'save_note'}];}}
]; const results=mutations.map(m=>{const response=clone(baseline[m.fixture.id]);m.mutate(response);const evaluated=evaluateCase(m.fixture,response);return {mutation:m.id,expected_code:m.code,detected:evaluated.issues.some(issue=>issue.code===m.code),observed_codes:evaluated.issues.map(issue=>issue.code)};}); return {schema_version:'0.1',baseline:{cases:fixtures.length,reference_gate:'passed'},mutations:results,total_mutations:results.length,detected_mutations:results.filter(r=>r.detected).length,missed_mutations:results.filter(r=>!r.detected).length,detection_rate:results.length?results.filter(r=>r.detected).length/results.length:1,gate_passed:results.every(r=>r.detected)};}
if(require.main===module){const fixturePath=path.resolve(__dirname,'../../docs/agentforge/fixtures/clinical-cases.json');const result=analyze(fixturePath);console.log(JSON.stringify(result,null,2));if(!result.gate_passed)process.exitCode=1;}
module.exports={analyze};
