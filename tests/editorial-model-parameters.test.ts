import test from 'node:test';
import assert from 'node:assert/strict';
import { generationRequest } from '../src/lib/editorial/generation';
import { suggestionRequest } from '../src/lib/editorial/suggestions';
import starters from '../src/data/editorial-starters.json';

const content = starters[0].content;
const source = content.evidence.map(e => e.quote).join(' ');
const solModels = ['openai/gpt-6-sol', 'openai/gpt-6.1-sol'];
const defaultModel = 'openai/gpt-4.1-mini';

// Include similar IDs to guard against broad prefix or provider matching.
for (const model of [defaultModel, 'test/model', 'openai/gpt-6-sol-pro', 'openai/gpt-6.1-sol-pro', 'openai/gpt-6-sol:batch', 'openai/gpt-6.1-sol:batch', 'other/gpt-6-sol', 'other/gpt-6.1-sol']) {
  test(`${model} retains the existing temperature in drafts and suggestions`, () => {
    const requests = [
      generationRequest(model, 'Source title', source),
      suggestionRequest(model, 'Source title', source, content, 'oneLiner', 'simplify'),
    ];
    for (const request of requests) {
      assert.equal(request.model, model);
      assert.equal(request.temperature, 0.3);
      assert.equal(JSON.parse(JSON.stringify(request)).temperature, 0.3);
    }
  });
}

for (const sol of solModels) {
  test(`${sol} draft requests omit temperature and preserve all other request settings`, () => {
    const request = generationRequest(sol, 'Source title', source);
    const { model: _model, temperature: _temperature, ...unchanged } = generationRequest(defaultModel, 'Source title', source);
    assert.equal(Object.hasOwn(request, 'temperature'), false);
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(request)), 'temperature'), false);
    assert.deepEqual(request, { model: sol, ...unchanged });
    assert.equal(request.provider.require_parameters, true);
    assert.equal(request.response_format.json_schema.strict, true);
  });

  test(`${sol} field suggestions omit temperature and preserve all other request settings`, () => {
    for (const field of ['oneLiner', 'shortVersion', 'wholePicture', 'whyItMatters'] as const) {
      const request = suggestionRequest(sol, 'Source title', source, content, field, 'simplify');
      const { model: _model, temperature: _temperature, ...unchanged } = suggestionRequest(defaultModel, 'Source title', source, content, field, 'simplify');
      assert.equal(Object.hasOwn(request, 'temperature'), false, field);
      assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(request)), 'temperature'), false, field);
      assert.deepEqual(request, { model: sol, ...unchanged });
      assert.equal(request.provider.require_parameters, true);
      assert.equal(request.response_format.json_schema.strict, true);
    }
  });
}
