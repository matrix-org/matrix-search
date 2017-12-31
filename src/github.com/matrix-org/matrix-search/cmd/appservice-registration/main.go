package main

import (
	"flag"
	"github.com/matrix-org/matrix-search/appservice"
)

func main() {
	pathPtr := flag.String("path", "my_registration_file.yaml", "The path to which to write the generated Registration YAML")
	urlPtr := flag.String("url", "http://where.the.appservice.listens:9999", "The URL on which this AS will listen, often localhost:port")
	localPartPtr := flag.String("localpart", "AppServiceUser", "The username/localpart of the Application Service")
	//configPathPtr := flag.String("config", "config.yaml", "The path to the matrix-search config YAML")

	flag.Parse()

	//conf, err := config.LoadConfig()
	//if err != nil {
	//	panic(err)
	//}

	reg := appservice.NewRegistration(*urlPtr, *localPartPtr)

	// Listen to all rooms
	reg.AddRoomNamespace(false, ".*")

	reg.Save(*pathPtr)
}
