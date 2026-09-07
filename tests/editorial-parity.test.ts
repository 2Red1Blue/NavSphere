import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { canonicalEditorialJson, parseEditorialJson, validateEditorialApproval, validateEditorialPublication } from '../src/lib/editorial-contract'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/editorial-publication-v1.json', import.meta.url), 'utf8'))
const python = fileURLToPath(new URL('../../.venv/bin/python3', import.meta.url))

function pythonCheck(value: unknown) {
  const result = spawnSync(python, ['-c', `
import json,sys
from scripts.editorial_publication import (canonical_editorial_json, parse_editorial_json,
  validate_editorial_approval, validate_editorial_publication, verify_private_evidence)
data=json.load(sys.stdin)
def check(value, parser):
  try: return {"accepted": True, "canonical": canonical_editorial_json(parser(value))}
  except ValueError: return {"accepted": False}
if "fixture" in data:
  fixture=data["fixture"]
  approval=validate_editorial_approval(fixture["manifest"], fixture["attestation"])
  verify_private_evidence(approval["manifest"]["publication"], fixture["packet"])
  print(json.dumps({key:approval[key] for key in ("publication_json","manifest_sha256","approval_digest","review_sha256")},ensure_ascii=False))
else:
  print(json.dumps({"publications":[check(v,validate_editorial_publication) for v in data["publications"]],
    "raw":[check(v,parse_editorial_json) for v in data["raw"]]},ensure_ascii=False))
`], { cwd: root, input: JSON.stringify(value), encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
}

test('Python evidence verification and edge approval hash exactly match the shared UTF-8 fixture', async () => {
  const local = pythonCheck({ fixture })
  const edge = await validateEditorialApproval(fixture.manifest, fixture.attestation)
  assert.deepEqual(local, fixture.expected)
  assert.equal(edge.publicationJson, fixture.expected.publication_json)
  assert.equal(edge.manifestSha256, fixture.expected.manifest_sha256)
  assert.equal(edge.approvalDigest, fixture.expected.approval_digest)
  assert.equal(edge.reviewSha256, fixture.expected.review_sha256)
})

test('cross-language publication and strict parser acceptance agrees on hostile Unicode and JSON', () => {
  const base = fixture.manifest.publication
  const publications = [structuredClone(base)]
  for (const headline of [
    '有限范围的测试结果 🧪 仍需独立复核',
    'éTODOé 是材料里的名称仍需核实',
    '测评ＴＯＤＯ结果只供合成测试使用',
    '材料不足以支持这个论断\u200b需要限定',
    '作者提到 www.example.test 的链接',
    '示例占位文字不能作为真实发布结果',
    '讨论 StraßE 与不同拼写的文字差异',
  ]) {
    const value = structuredClone(base)
    value.brief.headline.text = headline
    publications.push(value)
  }
  const duplicates = structuredClone(base)
  duplicates.brief.facts[0].text = '材料里的 Straße 仅用于大小写重复检测。'
  duplicates.brief.facts[1].text = '材料里的 STRASSE 仅用于大小写重复检测。'
  publications.push(duplicates)
  for (const url of ['javascript:alert(1)', 'https://user:password@example.test/', 'http://127.0.0.1/a', 'https://example.test/a?x=(1)&y=%2F']) {
    const value = structuredClone(base)
    value.evidence[0].url = url
    publications.push(value)
  }
  const raw = ['{"a":1,"a":2}', '{"nested":{"a":1,"a":2}}', '{"n":1.0}', '-0',
    '1e0', '9007199254740992', 'NaN', '"\\ud800"', '{"__proto__":{"safe":true}}',
    '{"a":"中文 🧪 & (x)","b":null}', '[true,false,1]', '[[1],]', '[0] trailing',
    '['.repeat(21) + '0' + ']'.repeat(21)]
  const local = pythonCheck({ publications, raw })
  function check(value: unknown, parser: (value: never) => unknown) {
    try { return { accepted: true, canonical: canonicalEditorialJson(parser(value as never)) } }
    catch { return { accepted: false } }
  }
  assert.deepEqual(publications.map((value) => check(value, validateEditorialPublication)), local.publications)
  assert.deepEqual(raw.map((value) => check(value, parseEditorialJson)), local.raw)
})
