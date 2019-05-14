const { Controller, Tag, CIP, TagGroup, EthernetIP, util } = require("./index");
const { Types } = CIP.DataTypes;


const PLC = new Controller(true);

PLC.addTemplate({
    name: "myUDT",
    definition: {
        udtINT: Types.INT,
    }
});

PLC.addTemplate({
    name: "testUDT",
    definition: {
        udString: "STRING",
        udStringArr: { type: "STRING", length: 3 },
        udINT: Types.BOOL,
        udINTArr: { type: Types.INT, length: 3 },
        udBool: Types.BOOL,
        udBoolArr: { type: Types.BOOL, length: 3 },
        udtNest: "myUDT",
    }
});

PLC.addTemplate({
    name: "simpleUDT",
    definition: {
        simpleINT: Types.INT,
        simpleSTRING: "STRING"
    },
});

PLC.addTemplate({
    name: "ASCIISTRING82",
    definition: {
        LEN: Types.DINT,
        DATA: { type: Types.SINT, length: 82 },
    },
});

PLC.addTemplate({
    name: "COUNTER",
    definition: {
        CU: Types.BOOL,
        PRE: Types.DINT,
        CTL: { type: Types.BOOL, length: 3 }
    },
});

const writeTag = new Tag("wtSTRING", "WriteTestProg", "STRING");
const arrTag = new Tag("myIntARRAY", "MainProgram", { type: Types.INT, length: 3 });
const udtTag = new Tag("rtUDT", "ReadTestProg", "testUDT"); // Program Scope Tag in PLC Program "prog"
const connTag = new Tag("myInt", "MainProgram", Types.INT);
const simpleTag = new Tag("testTagSimpleUDT", "MainProgram", "simpleUDT");
const asciiStr = new Tag("myStr", "MainProgram", "ASCIISTRING82");
const countTest = new Tag("customCount", "MainProgram", "COUNTER");
const largeTag = new Tag("largeTag", "MainProgram", Types.SINT);
// PLC.connect("192.168.1.11", 0).then(async () => {

//     /* Write String Test */
//     await PLC.readTag(writeTag);
//     writeTag.value.setString("MainWriteTest1");
//     await PLC.writeTag(writeTag);
//     console.log(`writeTag Name: ${writeTag.name}, value: ${writeTag.value.getString()}`);

//     /* Read UDT Test */
//     await PLC.readTag(udtTag).catch((err) =>{
//         console.log(err);
//     });
//     console.log(udtTag.value.udString.getString());
//     console.log(udtTag.value.udINT);
//     console.log(udtTag.value.udINTArr);

//     /* Read Array Test */
//     //await PLC.readTag(arrTag);
//     //console.log(`Array Tag: ${arrTag.name}, Value: ${arrTag.value}`);

//     /* TagList Test */
//     var { wellKnownTagList: wkList, fullTagList: fullList } = await PLC.readTagList();
//     console.log(wkList);

//     await PLC.disconnect();
//     await util.delay(1000);

//     /* Connected Test */
//     const PLCconn = new Controller(true);
//     PLCconn.connect("192.168.1.11", 0).then(async () => {
//         console.log("Connected to the second PLC");
//         await PLCconn.readTag(connTag);
//         //writeTag.value.setString("MainWriteTest1");
//         //await PLC.writeTag(writeTag);
//         //console.log(`writeTag Name: ${writeTag.name}, value: ${writeTag.value.getString()}`);
//         await PLCconn.disconnect();
//     });
// });

PLC.connect("192.168.1.11", 0).then(async () => {
    // const arrTag = new Tag("rtINTArrThree", "ReadTestProg", Types.DINT);
    // await PLC.readTag(arrTag);
    // console.log(arrTag.value);
    // await PLC.readTag(largeTag,510);
    // console.log(largeTag.value);
    // await PLC.readTag(asciiStr);
    // console.log(asciiStr.value);
    // await PLC.readTag(countTest);
    // console.log(countTest.value);
    var time = await PLC.readWallClock();
    var { tagList: tagList, templateList: udtList } = await PLC.readTagList();
    const dataTypeLookUp  = EthernetIP.CIP.DataTypes.Types;
    const isValidType = EthernetIP.CIP.DataTypes.isValidTypeCode;
    const getType = EthernetIP.CIP.DataTypes.getTypeCodeString;
    dataTypeLookUp.STRING = "STRING"; // Override String datatype, since it is very wrong...
    const timerTEMP = {
        name: "TIMER",
        definition: {
            CTL: Types.BOOL,
            PRE: Types.DINT,
            ACC: Types.DINT,
            EN: { type: Types.BOOL, length: 7 },
            TT: { type: Types.BOOL, length: 6 },
            D: { type: Types.BOOL, length: 5 },
        },
    };
    PLC.addTemplate(timerTEMP);
    for (const templates of udtList) {
        let templateObj = {
            name: templates.templateName,
            definition: {},
        };
        for (const members of templates.memberList) {
            if (members.info > 0) {
                if (members.type === "BOOL") {
                    if (members.info >= 32) {
                        templateObj.definition[members.asciiName] = { type: dataTypeLookUp[members.type], length: members.info };
                    } else {
                        templateObj.definition[members.asciiName] = dataTypeLookUp[members.type];
                    }
                } else {
                    templateObj.definition[members.asciiName] = { type: dataTypeLookUp[members.type], length: members.info };
                }
            } else {
                templateObj.definition[members.asciiName] = dataTypeLookUp[members.type];
            }
        }
        dataTypeLookUp[templates.templateName] = templates.templateName;
        if(templateObj.name.indexOf("big") >= 0) {
            console.log();
        }
        PLC.addTemplate(templateObj);
    }
    const huuugeUDT = new Tag("testTheBig", "MainProgram", "bigTestUDT");
    const smallUDT = new Tag("testTagSimpleUDT", "MainProgram", "simpleUDT");
    const padUDT = new Tag("padUDT", "MainProgram", "jhensonUDT");
    await PLC.readTag(smallUDT);
    await PLC.readTag(huuugeUDT);
    await PLC.readTag(padUDT);
    //console.log(huuugeUDT.value.udString);
    //console.log(smallUDT);
    const udtGroup = new TagGroup();
    for(const tags of tagList["Program:ReadTestProg"]) {
        if (isValidType(dataTypeLookUp[tags.symbolType])) {
            udtGroup.add(new Tag(tags.tagName, "ReadTestProg", dataTypeLookUp[tags.symbolType]));
        } else {
            udtGroup.add(new Tag(tags.tagName, "ReadTestProg", tags.symbolType));
        }
    }

    const cusTIMERTag = new Tag("myContTimer", null, "TIMER");
    const custStrTag = new Tag("custStrTest", "MainProgram", "mystrrrr");
    const custUDT = new Tag("testTagSimpleUDT", "MainProgram", "simpleUDT");
    // udtGroup.add(custStrTag);
    // udtGroup.add(custUDT);
    //await PLC.readTag(cusTIMERTag);
    //console.log(cusTIMERTag.value());
    await PLC.readTagGroup(udtGroup);
    udtGroup.forEach(tag => {
        console.log(`Read Tag with Name: ${tag.name}`);
        console.log(tag.value);
    });
    console.log(tagList);
    //await PLC.disconnect();
});

// PLC.connect("192.168.1.11",0).then(async () => {
//     var x = await PLC.writeGenericSingle(0xF5,0x01,0x06,Buffer([0x05,0x00,0x12,0x23,0x34,0x00]));
//     console.log(x);
//     x = await PLC.readGenericSingle(0xF5,0x01,0x06);
//     console.log(x);
//     x = await PLC.readGenericAll(0xF5,0x01);
//     console.log(x);
// });

// const PLC = new Controller();
// PLC.connect("192.168.1.11",0).then(async () => {
//     var x = await PLC.writeGenericSingle(0xF5,0x01,0x06,Buffer([0x05,0x00,0x12,0x23,0x34,0x00]));
//     console.log(x);
//     x = await PLC.readGenericSingle(0xF5,0x01,0x06);
//     console.log(x);
//     x = await PLC.readGenericAll(0xF5,0x01);
//     console.log(x);
//     try {
//         x = await PLC.writeGenericAll(0xF5,0x01,Buffer([0x00]));
//     } catch(err) {
//         console.log(err);
//     }
//     console.log(x);
// });