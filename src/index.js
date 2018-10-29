const Controller = require("./controller");
const pcccTag = require("./pcccTag");
const TagGroup = require("./tag-group");
const EthernetIP = require("./enip");
const util = require("./utilities");

const PLC = new Controller();

// Add some tags to group
PLC.subscribe(new pcccTag("N7:0")); // Controller Scope Tag

PLC.connect("192.168.1.11", 0).then(() => {
    // Set Scan Rate of Subscription Group to 50 ms (defaults to 200 ms)
    PLC.scan_rate = 50;

    // Begin Scanning
    PLC.scan();
});

// Catch the Tag "Changed" and "Initialized" Events
PLC.forEach(tag => {
    // Called on the First Successful Read from the Controller
    tag.on("Initialized", tag => {
        console.log("Initialized", tag.value);
    });

    // Called if Tag.controller_value changes
    tag.on("Changed", (tag, oldValue) => {
        console.log("Changed:", tag.value);
    });
});

// const barTag = new pcccTag("N7:0"); // Program Scope Tag in PLC Program "prog"
// const PLC = new Controller();
// PLC.connect("192.168.1.11", 0).then(async () => {
//     await PLC.writeTag(barTag,8811);
//     console.log("Trying to write 8811 to the tag, actual value:\n");
//     await PLC.readTag(barTag);
//     console.log(barTag.name+"->"+barTag.value);
// });
// module.exports = { Controller, pcccTag, TagGroup, EthernetIP, util };