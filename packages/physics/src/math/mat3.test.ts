import { describe, expect, it } from "vitest";

import { Mat3 } from "./mat3.js";
import { Vec3 } from "./vec3.js";

describe("Mat3", () => {
  it("IDENTITY is the 3x3 identity", () => {
    expect(Mat3.IDENTITY).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("of constructs a row-major matrix", () => {
    const m = Mat3.of(1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(m).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("fromDiagonal places components on the diagonal", () => {
    const m = Mat3.fromDiagonal(Vec3.of(2, 3, 5));
    expect(m).toEqual([2, 0, 0, 0, 3, 0, 0, 0, 5]);
  });

  it("multiplyVec3 with IDENTITY returns the same vector", () => {
    const v = Vec3.of(7, 11, 13);
    expect(Mat3.multiplyVec3(Mat3.IDENTITY, v)).toEqual(v);
  });

  it("multiplyVec3 computes row-major product", () => {
    const m = Mat3.of(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const v = Vec3.of(1, 0, 0);
    expect(Mat3.multiplyVec3(m, v)).toEqual(Vec3.of(1, 4, 7));
  });

  it("multiplyVec3 with diagonal scales each axis", () => {
    const m = Mat3.fromDiagonal(Vec3.of(2, 3, 5));
    expect(Mat3.multiplyVec3(m, Vec3.of(1, 1, 1))).toEqual(Vec3.of(2, 3, 5));
  });

  it("transpose swaps rows and columns", () => {
    const m = Mat3.of(1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(Mat3.transpose(m)).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });

  it("transpose of IDENTITY is IDENTITY", () => {
    expect(Mat3.transpose(Mat3.IDENTITY)).toEqual(Mat3.IDENTITY);
  });

  it("determinant of IDENTITY is 1", () => {
    expect(Mat3.determinant(Mat3.IDENTITY)).toBe(1);
  });

  it("determinant of a diagonal matrix is the product of diagonal entries", () => {
    expect(Mat3.determinant(Mat3.fromDiagonal(Vec3.of(2, 3, 5)))).toBe(30);
  });

  it("inverse of IDENTITY is IDENTITY", () => {
    expect(Mat3.equals(Mat3.inverse(Mat3.IDENTITY), Mat3.IDENTITY)).toBe(true);
  });

  it("inverse of diagonal matrix reciprocates the diagonal", () => {
    const d = Mat3.fromDiagonal(Vec3.of(2, 4, 5));
    const expected = Mat3.fromDiagonal(Vec3.of(0.5, 0.25, 0.2));
    expect(Mat3.equals(Mat3.inverse(d), expected, 1e-12)).toBe(true);
  });

  it("inverse times original is IDENTITY (general 3x3)", () => {
    const m = Mat3.of(1, 2, 3, 0, 1, 4, 5, 6, 0);
    expect(
      Mat3.equals(Mat3.multiplyMat3(m, Mat3.inverse(m)), Mat3.IDENTITY, 1e-12),
    ).toBe(true);
  });

  it("inverse throws on a singular matrix", () => {
    const singular = Mat3.of(1, 2, 3, 2, 4, 6, 3, 6, 9);
    expect(() => Mat3.inverse(singular)).toThrow(/singular/);
  });

  it("multiplyMat3 by IDENTITY is the original", () => {
    const m = Mat3.of(1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(Mat3.multiplyMat3(m, Mat3.IDENTITY)).toEqual(m);
    expect(Mat3.multiplyMat3(Mat3.IDENTITY, m)).toEqual(m);
  });

  it("equals respects epsilon", () => {
    const a = Mat3.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
    const b = Mat3.of(1 + 1e-12, 0, 0, 0, 1, 0, 0, 0, 1);
    const c = Mat3.of(1.01, 0, 0, 0, 1, 0, 0, 0, 1);
    expect(Mat3.equals(a, b, 1e-9)).toBe(true);
    expect(Mat3.equals(a, c, 1e-9)).toBe(false);
  });
});
