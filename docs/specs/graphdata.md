Data Types:
* Domain Name
  * format:
    * normal domain name format
* Hardware Address
  * format:
    * 1-5 numaric digits total
* Network Address
    * format: 
      * Must start with @
      * Max 10 characters total including @
      * Only letters, numbers, -, _, and / are allowed
    * examples:
      * @f1/123

We will have a few different types of nodes:
* Player
  * This is the player that is playing the game.
  * Tags: Logical, Player, User
* Network Port (RJ45)
  * Tags: Physical, NetworkPort, RJ45
* Network Port (Fiber Optic)
  * Tags: Physical, NetworkPort, Fiber Optic
* Network Switch
  * Tags: Physical, Device, Network, Switch
* Network Router
  * Tags: Physical, Device, Network, Router
* Server
  * Tags: Physical, Device, Server
* Floor
  * Tags: Physical, Location, Floor
* Rack
  * Tags: Physical, Location, Rack
* Uplink Port (RJ45)
  * Tags: Physical, NetworkPort, Uplink
* Uplink Port (Fiber Optic)
  * Tags: Physical, NetworkPort, Uplink
* Customer
  * Properties:
    * Customer Name
      * examples:
        * organic-goat
    * Network Address
  * Tags: Logical, User
* RoutingTable
  * This is a node that will be attached to routers via a relationship and will be used to represent the routing table of the router in question.
  * Tags: Logical, Routing
* User Port (RJ45/Fiber Optic)
  * Tags: Physical, NetworkPort, RJ45 or Fiber, UserPort
  * Properties:
    * Device Address
* Domain Name Registration
  * This node represents a domain name exists.
  * Tags: Logical, DomainName
  * Properties:
    * Domain Name

We will have several relationships I will note relative strengths as numbers where 0 is the strongest relationship possible:
* NIC
  * Strength: 0.5
  * from: Server|Switch|Router|Debugger etc
  * to: Network Port (RJ45) | Network Port (Fiber Optic)
* Owner
  * Strength: 4
  * from1: User
  * to1: UserPort (RJ45/Fiber Optic)
  * from2: User
  * to2: Domain Name Registration
  * from3: #Router
  * to3: RoutingTable
  * This links a port to it's Customer or a domain name registration to it's Consumer or the players
* Network Cable Link (RJ45)
  * Strength: 1.5
  * from/to: #NetworkPort and #RJ45
* Network Cable Link (Fiber Optic)
  * Strength: 1.0
  * from/to: #NetworkPort and #Fiber
* Floor Assignment (0, 1, 2, 3)
  * Strength: 3
  * from: Floor
  * to: Device | Rack
  * This is where a device is located
* Rack Assignment
  * from: Rack
  * to: Device
  * Strength: 2
* Uplink Port Connection
  * from/to Uplink Ports of same type
  * Strength: 5
* Route
  * from: RoutingTable
  * to: RoutingTable | #NetworkPort
  * Properties:
    * Target
      * Can be a datatype or a network address or a hardware address