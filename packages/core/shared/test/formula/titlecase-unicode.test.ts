import { formulaEvaluator } from '@inboxfm-connect/core-formula'
import { describe, expect, it } from 'vitest'

const result = (expr: string, data: Record<string, unknown> = {}) =>
    formulaEvaluator.evaluate({ expression: formulaEvaluator.wrap(expr), sampleData: data }).result

// titlecase() matched word starts with the ASCII-only `\w`, so a word beginning
// with a non-ASCII letter was not capitalized — and the *second* letter was,
// because the regex restarted at the first ASCII character:
//   titlecase("élan vital")  ->  "éLan Vital"
describe('titlecase: non-ASCII word starts', () => {
    it('capitalizes a word that starts with an accented letter', () => {
        expect(result('titlecase("élan vital")')).toBe('Élan Vital')
        expect(result('titlecase("über cool")')).toBe('Über Cool')
        expect(result('titlecase("çA VA")')).toBe('Ça Va')
    })

    it('capitalizes non-Latin scripts', () => {
        expect(result('titlecase("привет мир")')).toBe('Привет Мир')
        expect(result('titlecase("日本語 text")')).toBe('日本語 Text')
    })

    it('capitalizes the letter after a hyphen or underscore', () => {
        expect(result('titlecase("hello-world")')).toBe('Hello-World')
        expect(result('titlecase("snake_case word")')).toBe('Snake_Case Word')
    })

    it('keeps an apostrophe inside a word', () => {
        // The apostrophe is part of the word: "MCDONALD'S" must not become
        // "Mcdonald'S", so the letter after it stays lowercase.
        expect(result('titlecase("MCDONALD\'S")')).toBe('Mcdonald\'s')
    })
})

describe('titlecase: unchanged behaviour', () => {
    it('capitalizes every plain word', () => {
        expect(result('titlecase("acme inc")')).toBe('Acme Inc')
        expect(result('titlecase("john smith")')).toBe('John Smith')
    })

    it('lowercases the rest of each word', () => {
        expect(result('titlecase("MIXED case")')).toBe('Mixed Case')
    })

    it('leaves spacing and empty input alone', () => {
        expect(result('titlecase("  spaced  out ")')).toBe('  Spaced  Out ')
        expect(result('titlecase("")')).toBe('')
        expect(result('titlecase({{missing}})')).toBe('')
    })
})
