class SymbolParser {
    constructor() {
        this.parser = true;
    }

    /**
     * Parses the bitmap to an object per 1756-PM020
     * This uses hardcoded binary operators, please refer to page 49 of 1756 for explanations
     * @param {16-bit Buffer} bitmap 
     */
    parseSymbolType(bitmap) {
        const symbolObj = {};
        const securebitmap = bitmap & 0xFFFF;
        if (securebitmap & 0x8000) { // MSB for Structure Markup
            symbolObj.structureBit = "structure";
        } else {
            symbolObj.structureBit = "atomic";
        }
        /* eslint-disable indent */
        switch (securebitmap & 0x6000) { // Check Bits 14,13 für Array Size
            case 0x0000:
                symbolObj.arrayBit = "0";
                break;
            case 0x2000:
                symbolObj.arrayBit = "1";
                break;
            case 0x4000:
                symbolObj.arrayBit = "2";
                break;
            case 0x6000:
                symbolObj.arrayBit = "3";
                break;
            default:
                break;
        }

        if (securebitmap & 0x1000) { // Check Bit 12 for System Tag
            symbolObj.systemBit = "system";
        } else {
            symbolObj.systemBit = "user";
        }
        symbolObj.symbolType = securebitmap & 0b0000111111111111; // The symbol type only consists of the last 11 bits.
        return symbolObj;
    }

    checkSymbolName(nameString) {
        if (nameString.indexOf(":") > -1) {
            return "moduledef";
        } else if (nameString.indexOf("__" > -1)) {
            return "system";
        } else {
            return "user";
        }
    }

    _parseTemplateTillZero(data) {
        for (const [idx, chars] of data.entries()) {
            if (chars === 0) {
                return {
                    cutString: data.toString("ascii", 0, idx),
                    restBuf: data.slice(idx + 1, data.length),
                };
            } else {
                if (idx === data.length) {
                    console.log("Need to retrieve more");
                }
            }
        }
    }

    parseTemplate(templateAtt, templateData) {
        // Slice the buffer from memberCount * 8 Bytes (to get to the first name)
        // 8 in following calc (1756-PM202 pg. 55f):
        // 2 Bytes info
        // 2 Bytes type
        // 4 Bytes offset
        // 0 is appended to nameBuffer in order to make parsing easier
        const nameBuffer = Buffer.concat([templateData.slice(templateAtt.memberCount * 8, templateAtt.length), Buffer.from([0])]);
        let parsedName = this._parseTemplateTillZero(nameBuffer);
        const templateObj = {
            templateName: parsedName.cutString.split(";")[0], // We got the first bit till zero, now split at the char ';'
            memberList: [],
        };

        for (let i = 0; i < templateAtt.memberCount; i++) {
            let memberObj = {};
            memberObj.info = templateData.readUInt16LE(i * 8);
            memberObj.type = templateData.readUInt16LE((i * 8) + 2);
            memberObj.offset = templateData.readUInt32LE((i * 8) + 4);
            parsedName = this._parseTemplateTillZero(parsedName.restBuf);
            if (parsedName === undefined) {
                console.log("Error when parsing template response in symbolparser");
            }
            memberObj.asciiName = parsedName.cutString;
            if (!(memberObj.asciiName.indexOf("ZZZZZZZZZ") >= 0)) { // Filter hidden SINTS for BOOLs
                templateObj.memberList.push(memberObj);
            }
        }
        return templateObj;
    }

    parseTag() {

    }

    isUserTag(tagName) {
        if (tagName.indexOf("__") > -1) {
            return false; // System-Scope
        } else if (tagName.indexOf(":") > -1) {
            return false; // Module-Scope
        } else {
            return true; // User-Scope
        }
    }
    /**
     * Takes a symbolType Object from the retrieved TagList and
     * converts it to a standardized Template Object, then pushes that Object to a list.
     * This function is used internally to split the Templates from the TagList and
     * fill a list with these Templates. Caution: Recursion.
     * @param {Object} templateObj - An object containing Template-Information in SymbolType format
     * @param {Array} tempList - [out]: A list that is passed / returned to contain the Template Objects
     * @memberof SymbolParser 
     */
    _formatAndPushTemplate(templateObj, tempList) {
        const newTempObj = {
            templateName: templateObj.templateName,
            memberList: [],
        };
        try {
            for (const members of templateObj.memberList) {
                if (typeof members.type === "object" && members.type !== null) {
                    const newTempMemObj = JSON.parse(JSON.stringify(members));
                    if (members.type.templateName === "ASCIISTRING82") {
                        newTempMemObj.type = "STRING";
                    } else {
                        newTempMemObj.type = members.type.templateName;
                    }
                    newTempObj.memberList.push(newTempMemObj);
                    this._formatAndPushTemplate(members.type, tempList);
                } else {
                    newTempObj.memberList.push(members);
                }
            }
        } catch (e) {
            console.log(e);
        }
        if (!(tempList.some(templateObj => templateObj.templateName === newTempObj.templateName))) {
            tempList.push(newTempObj);
        }
    }

    /**
     * Filters the Templates from the tagList and puts them in a list
     * @param {Object} tagList - The taglist as delivered by the Controller
     * @returns {Array} An array containing only Templates in standardized format
     */
    filterTemplates(tagList) {
        const templateList = [];
        Object.keys(tagList).forEach((progs) => {
            for (const tags of tagList[progs]) {
                if (typeof tags.symbolType === "object" && tags.symbolType !== null) {
                    this._formatAndPushTemplate(tags.symbolType, templateList);
                }
            }
        });
        return templateList;
    }

    /**
     * Sorts a list of UDTs by retrieving their Nest-Level and sorting accordingly.
     * @param {Array} udtSList - A list of unsorted UDT-Templates in standardized format
     */
    sortNestedTemplates(udtSList) {
        const udtList = JSON.parse(JSON.stringify(udtSList));
        const templateNameList = [];
        const nestedUDTs = {};
        for (const templates of udtList) {
            templateNameList.push(templates.templateName);
        }
        for (const templates of udtList) {
            nestedUDTs[templates.templateName] = [];
            for (const members of templates.memberList) {
                if (templateNameList.includes(members.type)) {
                    nestedUDTs[templates.templateName].push([members.asciiName, members.type]);
                    // console.log(`Found a nest in ${templates.templateName} with member: ${members.asciiName} and type: ${members.type}`);
                }
            }
        }
        Object.keys(nestedUDTs).forEach((udt) => {
            const nestLvl = this._determineUdtNestLevel(nestedUDTs, udt);
            // console.log(`NestLevel ${nestLvl} for UDT ${udt} (higher is 'worse')`);
            nestedUDTs[udt].nestLevel = nestLvl;
        });
        for (const templates of udtList) {
            templates.nestLevel = nestedUDTs[templates.templateName].nestLevel;
        }
        return udtList.sort(this._compareNestLevels);
    }

    /**
     * Determines the Nest-Level of a UDT by starting with a level of 0
     * and recursing further into the structure until no more nests are found.
     * @param {Array} nestList 
     * @param {Object} udt 
     * @param {Number} nestLevel 
     */
    _determineUdtNestLevel(nestList, udt, nestLevel = 0) {
        if (nestList[udt].length === 0) {
            return nestLevel;
        } else {
            const nLvl = nestLevel + 1;
            for (const nests of nestList[udt]) {
                return this._determineUdtNestLevel(nestList, nests[1], nLvl);
            }
        }
        return "err";
    }

    /**
     * Comparison function used in sorting the UDTs by nest-level. 
     * @param {Object} udtA 
     * @param {Object} udtB 
     * @returns {boolean} truthy, if the nestLevel of A>B, falsy, otherwise
     */
    _compareNestLevels(udtA, udtB) {
        return udtA.nestLevel - udtB.nestLevel;
    }


    /**
     * In order to fit with the defined TagList-Format, the information about templates does not longer need
     * to be part of the TagList. Thus, we reduce the symbolType Objects of UDTs to their templateName.
     * @param {Object} tagList 
     * @returns {Object} The tagList templateNames as UDT-symbolTypes instead of whole objects
     */
    adjustTagListFormat(tagList) {
        const newList = {};
        Object.keys(tagList).forEach((prog) => {
            newList[prog] = [];
            for (const tags of tagList[prog]) {
                if (typeof tags.symbolType === "object" && tags.symbolType !== null) {
                    newList[prog].push({ tagName: tags.tagName, symbolType: tags.symbolType.templateName });
                } else {
                    newList[prog].push(tags);
                }
            }
        });
        return newList;
    }
}

module.exports = SymbolParser;