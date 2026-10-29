import { formulaEvaluator } from '@inboxfm-connect/core-formula'
import { describe, expect, it } from 'vitest'

const result = (expr: string, data: Record<string, unknown> = {}) =>
    formulaEvaluator.evaluate({ expression: formulaEvaluator.wrap(expr), sampleData: data }).result

// slug() lowercased, NFKD-decomposed and then replaced everything outside
// [a-z0-9] with a dash. Only letters that NFKD decomposes into ASCII survived;
// letters such as ß, Ø, Æ and Ł do not decompose, so they were treated as
// separators and silently disappeared:
//   slug("Straße 5") -> "stra-e-5"   (should be "strasse-5")
//   slug("Øre")      -> "re"         (should be "ore")
// A slug is used as a stable URL key, so dropping a letter merges distinct
// titles and produces broken links.
describe('slug: letters that do not NFKD-decompose', () => {
    it('keeps German sharp s as ss', () => {
        expect(result('slug("Straße 5")')).toBe('strasse-5')
        expect(result('slug("GROSSE STRASSE")')).toBe('grosse-strasse')
    })

    it('keeps Nordic and ligature letters', () => {
        expect(result('slug("Øre")')).toBe('ore')
        expect(result('slug("Æther")')).toBe('aether')
        expect(result('slug("Œuvre")')).toBe('oeuvre')
        expect(result('slug("Þingvellir")')).toBe('thingvellir')
    })

    it('keeps Slavic letters', () => {
        expect(result('slug("Łódź")')).toBe('lodz')
        expect(result('slug("Đakovo")')).toBe('dakovo')
    })

    it('does not merge two different titles into the same slug', () => {
        expect(result('slug("Straße")')).not.toBe(result('slug("Stra e")'))
        expect(result('slug("Øre")')).not.toBe(result('slug("re")'))
    })
})

describe('slug: unchanged behaviour', () => {
    it('handles accents that decompose', () => {
        expect(result('slug("Déjà vu")')).toBe('deja-vu')
        expect(result('slug("naïve café")')).toBe('naive-cafe')
    })

    it('lowercases, hyphenates and trims dashes', () => {
        expect(result('slug("Hello World!")')).toBe('hello-world')
        expect(result('slug("--a--b--")')).toBe('a-b')
        expect(result('slug("")')).toBe('')
    })
})
