import { weekCounts } from '../src/core/analysis/levelWords';

test('the week on Hem in words, "utan" never alone', () => {
  expect(weekCounts({ green: 0, yellow: 1, red: 0 }, 6)).toBe('1 gul dag, 6 dagar utan avstämning');
  expect(weekCounts({ green: 5, yellow: 1, red: 0 }, 1)).toBe('5 gröna dagar, 1 gul, 1 dag utan avstämning');
  expect(weekCounts({ green: 7, yellow: 0, red: 0 }, 0)).toBe('7 gröna dagar');
  expect(weekCounts({ green: 0, yellow: 0, red: 0 }, 7)).toBe('7 dagar utan avstämning');
  expect(weekCounts({ green: 4, yellow: 2, red: 1 }, 0)).toBe('4 gröna dagar, 2 gula, 1 röd');
});
