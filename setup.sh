# performance optimisations ##
##############################
# increate udp buffer size, to reduce latency
sudo sysctl -w net.core.rmem_max=5000000
sudo sysctl -w net.core.wmem_max=5000000
