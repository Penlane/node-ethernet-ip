const pcccTag = require("./index");
const { Types } = require("../enip/pccc/data-types");

describe("PCCC Tag Class", () => {
    describe("New Instance", () => {
        it("Throws Error on Invalid Inputs", () => {
            const fn = (tagname, readCount, type = Types.UDINT) => {
                return () => new pcccTag(tagname, readCount, type);
            };

            expect(fn(1234)).toThrow();
            expect(fn("hello")).toThrow();
            expect(fn("N7:0")).not.toThrow();
            expect(fn("N7:0,3")).toThrow();
            expect(fn("N7:0", 3, "INT")).toThrow();
            expect(fn("N7:0", 3, Types.INT)).not.toThrow();
            expect(fn("N7:0",1000)).toThrow();

        });
    });

    describe("Tagname Validator", () => {
        it("Accepts and Rejects Appropriate Inputs", () => {
            const fn = test => pcccTag.isValidTagname(test);

            expect(fn("N17:0")).toBeTruthy();
            expect(fn(12345)).toBeFalsy();
            expect(fn(null)).toBeFalsy();
            expect(fn(undefined)).toBeFalsy();
            expect(fn("N7.0")).toBeTruthy();
            expect(fn({ prop: "value" })).toBeFalsy();
            expect(fn("fffffffffffffffffffffffffffffffffffffffff")).toBeFalsy();
            expect(fn("ffffffffffffffffffffffffffffffffffffffff")).toBeTruthy();
            expect(fn("B3:0/023")).toBeFalsy();
            expect(fn("F8:0[3]")).toBeFalsy();
            expect(fn("I4:0")).toBeTruthy();
            expect(fn("F8:0,3")).toBeFalsy();
            expect(fn("Program:program.N7:0")).toBeFalsy();
        });
    });

    describe("Read Message Generator Method", () => {
        it("Generates Appropriate Buffer", () => {
            const tag1 = new pcccTag("N7:0");
            const tag2 = new pcccTag("N7:0", 3, Types.INT);
            const tag3 = new pcccTag("F8:0");
            const tag4 = new pcccTag("B3:0/0");
            const tag5 = new pcccTag("B3:0/0", 2);

            expect(tag1.generateReadMessageRequest()).toMatchSnapshot();
            expect(tag2.generateReadMessageRequest()).toMatchSnapshot();
            expect(tag3.generateReadMessageRequest()).toMatchSnapshot();
            expect(tag4.generateReadMessageRequest()).toMatchSnapshot();
            expect(tag5.generateReadMessageRequest()).toMatchSnapshot();
        });
    });

    describe("Write Message Generator Method", () => {
        it("Generates Appropriate Buffer", () => {
            const tag1 = new pcccTag("N7:0");
            const tag2 = new pcccTag("N7:0", 3, Types.INT);
            const tag3 = new pcccTag("F8:0");
            const tag4 = new pcccTag("B3:0/0");
            const tag5 = new pcccTag("B3:0/0", 2);


            expect(tag1.generateWriteMessageRequest(100)).toMatchSnapshot();
            expect(tag2.generateWriteMessageRequest(25)).toMatchSnapshot();
            expect(tag3.generateWriteMessageRequest(32.1234)).toMatchSnapshot();
            expect(tag4.generateWriteMessageRequest(true)).toMatchSnapshot();
            expect(tag5.generateWriteMessageRequest(false)).toMatchSnapshot();
        });
    });

    describe("keepAlive parameter", () => {
        it("should allow a number input", () => {
            const testTag = new pcccTag("testkeepalive", undefined, undefined, 10);
            expect(testTag).toBeInstanceOf(pcccTag);
        });

        it("should throw an error on non-number types", () => {
            expect(() => {
                new pcccTag("testkeepalive", undefined, undefined, "apple");
            }).toThrowError("Tag expected keepAlive of type <number> instead got type <string>");
        });

        it("should throw an error if keepAlive is less than 0", () => {
            expect(() => {
                new pcccTag("testkeepalive", undefined, undefined, -20);
            }).toThrowError("Tag expected keepAlive to be greater than 0, got -20");
        });
    });

    describe("bitIndex parameter", () => {
        it("should be null if no bit index is in tag name", () => {
            const testTag = new pcccTag("tag");
            expect(testTag.bitIndex).toEqual(null);
        });

        it("should equal bit index", () => {
            const testTag = new pcccTag("tag.5");
            expect(testTag.bitIndex).toEqual(5);
        });
    });
});
