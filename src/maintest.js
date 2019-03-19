const { Controller, Tag, CIP, TagGroup, EthernetIP, util } = require("./index");
const { Types } = CIP.DataTypes;


const PLC = new Controller(false);

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

const writeTag = new Tag("wtSTRING", "WriteTestProg", "STRING");
const arrTag = new Tag("myIntARRAY", "MainProgram", { type: Types.INT, length: 3 } );
const udtTag = new Tag("rtUDT", "ReadTestProg", "testUDT"); // Program Scope Tag in PLC Program "prog"
const connTag = new Tag("myInt", "MainProgram", Types.INT);

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

PLC.connect("192.168.1.11",0).then(async () => {
    // const arrTag = new Tag("rtINTArrThree", "ReadTestProg", Types.DINT);
    // await PLC.readTag(arrTag);
    // console.log(arrTag.value);
    await PLC.readTagList();
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