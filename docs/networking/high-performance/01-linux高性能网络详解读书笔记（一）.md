---
title: "linux高性能网络详解读书笔记（一）"
sidebar_label: "01. linux高性能网络详解读书笔记（一）"
sidebar_position: 1
description: "程序在向设备发送数据时，会先将数据写入数据发送缓存，然后（一般使用写设备寄存 器的方式）通知设备通过 DMA 操作来读取数据。设备如果有数据要传递给程序，会先将数 据写入数据接收缓存，然后发起中断通知程序来获取。 由于 Cache 机制的存在，在上述数据交换的过程中，可能会出现如下问题。"
tags: [Linux, 网络, 高性能, 读书笔记]
date: 2025-11-05 10:30:00
categories: 高性能网络
---

# linux高性能网络详解读书笔记（一）

## 1. 三种cache操作指令 {/* #三种cache操作指令 */}
![1](/images/Linux高性能网络详解读书笔记（一）/1.png)
程序在向设备发送数据时，会先将数据写入数据发送缓存，然后（一般使用写设备寄存
器的方式）通知设备通过 DMA 操作来读取数据。设备如果有数据要传递给程序，会先将数
据写入数据接收缓存，然后发起中断通知程序来获取。
由于 Cache 机制的存在，在上述数据交换的过程中，可能会出现如下问题。

• 问题 1。在程序向设备发送数据的场景中，处理器执行了将数据写入内存的指令后，
数据很可能并没有被真正地写入内存，而是临时保存到了 Cache 中。此时，设备到内
存中读取数据时，读取到的将是无效的数据。
• 问题 2。在设备将数据传递给程序的场景中，设备将数据写入内存后，程序运行内存
访问指令去读取数据时，Cache 中可能会有以前获取的关于这段内存地址的缓存。此
时处理器不会去读取内存，而是直接使用 Cache 中的旧数据。
• 问题 3。某段缓存可能先被用来发送数据（程序→设备），然后被用来接收数据（设
备→程序），对于这种缓存，前两个问题都可能发生。

针对上述三个问题，处理器提供了三种操作 Cache 的指令：Clean、Invalid 和 Flush。不
过有的处理器只提供对全部内存地址都有效的三种指令；有的处理器提供的三种指令可以只
对某一段内存地址有效，执行时需要指定有效的内存地址范围。

这三种 Cache 操作指令的作用分别如下。
• Clean：清除。将属于目标地址范围的被标记为 Dirty 的 Cache Line 写到内存中。Dirty
的意思是，此 Cache Line 中的数据被处理器从内存读取到 Cache 后曾被修改过，并且
尚未被写回内存。
• Invalid：使无效。将属于目标地址范围的所有 Cache Line 设置为无效。这样做的效果
是，处理器下次访问这段地址时会直接到内存读取数据，不再使用 Cache 中临时保存
的数据。
• Flush：刷新。将属于目标地址范围的所有 Cache Line，先清除（Clean）再使无效
（Invalid）。
程序可以使用 Clean、Invalid、Flush 这三种指令，分别解决前文提到的三个问题。
对于问题 1，程序可以在（写寄存器）通知设备来读取数据前，先执行 Clean 指令，将
Cache 中的数据更新到内存。
对于问题 2，程序可以在收到设备通知后，去内存读取数据前先执行 Invalid 指令，将
Cache 中的数据设置为无效。在此之后，处理器就会真正到内存中读取数据了。
对于问题 3，程序可以在发送数据的过程中，通知设备来读取数据前执行 Flush 指令。
另外还有一种方法，即配置 MMU，针对数据缓存所在的内存地址范围关闭 Cache 功能，
可以一次性地解决上述所有三个问题。大多数对性能要求不高的程序会采用这种简单的方法。

## 2. 总线带宽 {/* #总线带宽 */}
总线带宽（bit/s） = 频率×宽度

## 3. 用户态与内核态 {/* #用户态与内核态 */}
用户态和内核态是Linux操作系统中运行的进程可能所处的两种状态。
假设用户现在运行了一个应用程序，即在操作系统中启动了一个进程。当进程执行应用程序自己的代码时，我们称该进程处于用户运行状态（简称用户态）。当该进程执行系统调用后进入内核代码中执行时，我们称该进程处于内核运行状态（简称内核态）。

进程在用户态和内核态执行时，所拥有的权限（主要是指令执行权限和内存访问权限）不同。以 Intel 处理器为例，其有 4 个特权级别：Ring 0、Ring 1、Ring 2、Ring 3。Ring 0 级别最高，Ring 3 级别最低。Linux 使用 Ring 0 级别执行内核态代码，Ring 3 级别执行用户态代码，不使用 Ring 1 和 Ring 2。处理器在 Ring 3 级别执行时，无法执行 Ring 0 级别才能执行的某些（如停机指令 HLT 等）指令，无法访问运行在 Ring 0 级别才能访问的内存地址空间（包括代码和数据）。这种机制保证了整个系统的安全，避免了应用程序执行非法的操作（比如访问操作系统本身的内存）。
![2](/images/Linux高性能网络详解读书笔记（一）/2.png)

进程可以在用户态和内核态之间切换。比如运行在用户态的程序可以执行系统调用而进
入内核态；处理器收到中断时，会马上进入内核态执行中断处理程序；当系统调用或中断处
理程序执行完成后，进程会切换回用户态继续执行。

## 4. 虚拟地址，物理地址与页表 {/* #虚拟地址物理地址与页表 */}
程序访问的内存地址是虚拟地址，会由内存管理单元（MMU）进行转化，转化为物理地址。
### 4.1 分页 {/* #分页 */}
分页是指把物理内存分成固定大小的块，每块就是一个页，操作系统以页为单位进行内存的管理。Linux 操作系统中，一般页的大小为4KB，之后又由于一些因素（主要是访问效率、TLB miss［未命中］等），出现了更大的页，比较典型的是 2MB 和 1GB 大小的大页（huge page）。

下图展示的是在 x86 架构的 32 位处理器上进行一次虚拟地址到物理地址转换的示意。图中使用的页表是一个二级页表（第一级称为页目录表，第二级称为页表），处理器把一个32 位的虚拟地址分成 3 段，每段都作为一个地址偏移。MMU 进行查表的顺序如下。
（1）将虚拟地址的位[31:22]（作为一个单独的数）乘 4（原因是每个存放 32 位地址的表项占 4 字节），加上页表基地址寄存器 CR3 中存放的页目录表的基地址，获得页目录表中对应表项的物理地址，读取其内容，获得页表中某个页的基地址。
（2）将虚拟地址的位[21:12]乘 4，加上第（1）步获得的页的基地址，获得页表中对应表项的物理地址，读取其内容，从而获得目标内存所在页的物理地址（这个地址的[11:0]位为 0）。
（3）将虚拟地址的位[11:0]加上第（2）步获得的内存页的物理地址，得到目标物理地址。使用这个地址访问物理总线即可。
![3](/images/Linux高性能网络详解读书笔记（一）/3.png)

## 5. Corundum开源网卡方案 {/* #corundum开源网卡方案 */}

### 5.1 Corundum 的队列 {/* #corundum-的队列 */}
Corundum 方案中使用了队列，在收发数据前，必须先创建队列。Corundum 方案中共有5 种队列，包括发送队列、发送完成队列、接收队列、接收完成队列、事件队列。每种队列的数量以及队列内元素（描述符）的数量各不相同，具体的数量取决于硬件的能力和软件的配置。但是，发送队列和发送完成队列必须是一一对应的，意思是这两种队列的数量相同，两种队列内描述符的数量也相同。接收队列和接收完成队列也是一一对应的。数据发送和数据接收过程中使用的队列不同，图 6-3 展示了数据发送过程中使用的队列和操作流程，图中箭头是指主要数据或命令的传递方向。
对应图 6-3 中的编号，数据发送过程如下。
① 协议栈调用驱动程序初始化时注册的数据发送函数。
② 数据发送函数填充“发送队列”（向其描述符中填写数据包的地址、长度等），并更新软件计数的“发送队列”的 head。
③ 数据发送函数将“发送队列”的新 head 写入硬件提供的“发送队列”的 head 寄存器，硬件读取“发送队列”中的新描述符以获取待发送数据的地址和长度。
④ 硬件发送完数据包后，填充“发送完成队列”（主要是向其描述符中填写已发送的数据包的长度和处理的“发送队列”中的描述符索引等），并更新硬件计数的“发送完成队列”的 head。
⑤ 硬件继续填充“事件队列”（主要是向其描述符中填写已完成的事件类型——发送完成，和刚刚填充的“发送完成队列”的索引），更新硬件计数的“事件队列”的 head，随后发起中断。
![4](/images/Linux高性能网络详解读书笔记（一）/4.png)
⑥ CPU 收到中断，调用驱动程序注册的中断处理函数。中断处理函数读取“事件队列”的head 寄存器，从硬件获取“事件队列”的 head，发现和软件自己记录的“事件队列”的 tail 不相等，表明有新事件发生。然后从“事件队列”中读取描述符获取新事件，经判断，此事件是一个发送完成事件。“事件队列”描述符中还包含了对应此事件的“发送完成队列”的索引，即编号。
⑦ 中断处理函数（引发 NAPI 调度）调用数据发送完成处理函数。
⑧ 数据发送完成处理函数读取“发送完成队列”的 head 寄存器，发现新 head 和自己记录的“发送完成队列”的 tail 不相等，表明“发送完成队列”中有新的描述符（意味着有数据被硬件发送出去了）。随后读取“发送完成队列”中的描述符，获知硬件处理过的“发送队列”的描述符的索引，将其指向的数据缓存释放。最后更新软件中“发送完成队列”的 tail计数，并写 tail 寄存器告知硬件处理完成。

图 6-4 展示了数据接收过程中使用的队列和操作流程，图中箭头是指主要数据或命令的传递方向。
对应图 6-4 中的编号，数据接收过程如下。
① 驱动程序初始化过程中，或上一个数据包接收完成后，驱动程序会填充“接收队列”，即向其描述符中写入可存放下一次接收到的数据的数据缓存的地址和长度。随后，更新软件计数的“接收队列”的 head，同时写“接收队列”的 head 寄存器通知硬件。
② 硬件发现“接收队列”的 head 和自己记录的 tail 不相等，开始从“接收队列”读取描述符信息，获知下一次接收到的数据包可以存放的数据缓存的地址。
③ 硬件从网络收到数据包，放入数据缓存后，向“接收完成队列”填充一个描述符（含接收到的数据包长度和对应的“接收队列”描述符的索引），并更新硬件计数的“接收完成队列”的 head。
![5](/images/Linux高性能网络详解读书笔记（一）/5.png)
④ 硬件继续向“事件队列”填充一个描述符（含本次的事件类型——接收完成，以及使用的“接收完成队列”的索引），并更新硬件计数的“事件队列”的 head，随后向 CPU 发起中断。
⑤ CPU 收到中断，调用驱动程序初始化时注册的中断处理函数。中断处理函数读取“事件队列”的 head 寄存器，从硬件获取“事件队列”的新 head，发现和自己记录的“事件队列”的 tail 不相等，表明有新事件发生。然后从“事件队列”读取新描述符，得知新事件类型为接收完成；并从描述符获得对应此事件的“接收完成队列”的索引，即编号。
⑥ 中断处理函数随后调用数据接收完成处理函数。
⑦ 数据接收完成处理函数读取“接收完成队列”的 head 寄存器，发现和自己记录的“接收完成队列”的 tail 不相等，表明队列中有新的描述符（意味着有新数据被硬件接收了）。随后，读取“接收完成队列”的描述符，获知收到的数据包的长度以及对应的“接收队列”中的描述符索引（同时获得了此描述符指向的存放接收到的数据的数据缓存的地址）。最后更新软件中“接收完成队列”的 tail 计数，并写“接收完成队列”的 tail 寄存器告知硬件处理完成。
⑧ 驱动程序将收到的数据交给协议栈。随后重新填充“接收队列”，即回到①。
以上内容描述了 Corundum 方案中的各种队列在数据发送和数据接收过程中所起的作用。
在后文的代码解析中，读者可以重点关注程序是如何操作这些队列的。

### 5.2 驱动程序的加载与注册 {/* #驱动程序的加载与注册 */}
```c
module_init(mqnic_init);
module_exit(mqnic_exit);
```
这两行代码是在告诉内核：在用户加载（insmod）此驱动程序的时候，请调用函数mqnic_init；在用户卸载（rmmod）此驱动程序的时候，请调用函数 mqnic_exit。

继续进入 mqnic_init 和 mqnic_exit 这两个函数的内部。
```c
static int __init mqnic_init(void)
{
 return pci_register_driver(&mqnic_pci_driver);
}
static void __exit mqnic_exit(void)
{
 pci_unregister_driver(&mqnic_pci_driver);
}
```
内容非常简洁，加载时，mqnic_init 函数调用 pci_register_driver 函数向内核注册了一个名为 mqnic_pci_driver 的变量，此变量所使用的数据结构为 struct pci_driver。这个语句的作用是向内核注册一个 PCI 设备驱动程序。卸载时，mqnic_exit 函数调用 pci_unregister_driver函数把驱动程序从内核中移除。

### 5.3 驱动程序和设备的匹配 {/* #驱动程序和设备的匹配 */}

驱动程序加载到内核后，一旦内核检测到对应的设备，就可以使用驱动程序去控制设备了。这句话有两个关键词，一个是“检测”，另一个是“对应”。
检测是指操作系统首先要发现这个设备，这是由操作系统使用总线的驱动程序（本例中为 PCIe 总线，使用内核中的 PCI 总线驱动）扫描整个总线实现的。对于 Linux，扫描 PCI 总线的操作发生在操作系统的启动过程中。因此，系统启动后，工程师就可以随时输入 lspci 命令去查看 PCI 总线上的所有设备，即使这个设备本身的驱动程序还没有被加载到内核。在此我们不考虑热插拔的情况，所以需要在开机前就把 FPGA 网卡插到 PCIe 插槽中。对应是指驱动程序和设备的匹配。具体到当前这个场景，Corundum 的网卡驱动程序如何匹配插在 PCIe 插槽上的 FPGA 卡呢？这就又要涉及前文提到过的设备 ID 了。前文提到驱动程序加载时调用pci_register_driver向内核注册了一个名为mqnic_pci_driver（数据结构为 struct pci_driver）的变量，此变量定义如下：
```c
static struct pci_driver mqnic_pci_driver = {
 .name = DRIVER_NAME,
 .id_table = mqnic_pci_id_table,
 .probe = mqnic_pci_probe,
 .remove = mqnic_pci_remove,
 .shutdown = mqnic_pci_shutdown
};
```

其各主要成员的意义如下。
• mqnic_pci_id_table：当前驱动程序支持的设备 ID 列表。
• mqnic_pci_probe：驱动程序和设备匹配以后最先调用的函数。
• mqnic_pci_remove：设备被从系统移除（一般是设备被拔出）时调用的函数。
主要关注数据结构中的第二个成员 mqnic_pci_id_table 的定义：

```c
static const struct pci_device_id mqnic_pci_id_table[] = {
 { PCI_DEVICE(0x1234, 0x1001) },
 { PCI_DEVICE(0x5543, 0x1001) },
 { 0 /* end */ }
};
```
Linux 内核匹配驱动程序和设备的过程是这样的：
1.在 Corundum 驱动程序向内核注册后，内核就知道了这是一个 PCI 设备（因为驱动程序所使用的注册函数是 pci_register_driver）。
2.随后，内核从驱动程序定义的 pci_driver 结构（mqnic_pci_driver 变量）的成员 id_table（mqnic_pci_id_table）得知此驱动程序支持设备 ID 为“0x1234, 0x1001”和“0x5543, 0x1001”
的 PCI 设备。
3.于是内核去查找自己已经通过 PCI 总线扫描到的设备的列表，如果发现其中有一个设备的 ID 为“0x1234, 0x1001”（正是作者之前用 lspci 命令查看的）或“0x5543, 0x1001”，内核就认为 Corundum 网卡驱动程序和这个设备相匹配。然后，内核开始调用 pci_driver 结构中定义的 probe 函数 mqnic_pci_probe。

### 5.4 初始化阶段 {/* #初始化阶段 */}

内核开始调用 probe 函数 mqnic_pci_probe，这意味着进入了网卡驱动的初始化阶段。

#### 5.4.1 probe 函数 {/* #1probe函数 */}
如果说 mqnic_init 是驱动程序加载的入口，那么 probe 函数 mqnic_pci_probe 就是驱动程序真正开始工的入口，内核一旦找到了和驱动程序匹配的设备，第一个运行的就是这个probe 函数。
此函数比较长，在此依次截取一些重要的片段进行解释。
**probe 函数代码片段 1：**

```c
 struct mqnic_dev *mqnic;
 struct device *dev = &pdev->dev;
...... //此处删除了不重要的代码（比如打印、错误处理、和主流功能无关的配置等）以突出重点，本书后面章节的代
..... //码解析都是如此
if (!(mqnic = devm_kzalloc(dev, sizeof(*mqnic), GFP_KERNEL)))
//为当前 PCI 设备申请私有数据存储空间
 {
 return -ENOMEM;
 }
 mqnic->dev = dev;
 mqnic->pdev = pdev;
pci_set_drvdata(pdev, mqnic);
//把 mqnic 变量设置为当前 PCI 设备的私有数据
```
作者在代码中加的后两句注释就是此段代码的主要作用。这段代码为 mqnic 指针指向的数据结构申请了地址空间，此数据结构将成为当前 PCI 设备的私有数据结构。在 probe 函数接下来的流程中，程序会陆续把一些初始化后得到的值保存到 mqnic 指向的数据结构中。由于这段代码的最后通过调用 pci_set_drvdata 把设备私有数据结构的地址注册到了 Linux 内核的 PCI 设备驱动程序框架，而驱动程序框架在以后调用驱动程序注册（此注册是通过 mqnic_pci_driver 变量的声明实现的）的其他回调函数时，会在参数中带上设备私有数据结构的地址。因此，驱动程序中的其他函数也可以使用设备的私有数据了，进而得到probe 函数做初始化时保存的各种变量的值。
这种把设备私有数据结构注册到驱动程序框架，再被驱动程序注册的回调函数使用的方法，是各种 Linux 驱动程序架构常用的一种技巧。
##### 5.4.1.1 什么是回调函数 {/* #什么是回调函数 */}
回调函数（Callback Function）是 由开发者定义、但由另一个系统（如内核框架）在特定时机自动调用的函数。简单说就是：“我写的函数，交给框架保管，框架在需要的时候（比如设备被检测到、被移除时）主动调用它”。
##### 5.4.1.2 为什么驱动的其他函数能通过回调函数获取私有数据地址？ {/* #为什么驱动的其他函数能通过回调函数获取私有数据地址 */}
核心原因是 Linux 驱动框架会 “传递上下文”，而私有数据的地址就包含在这个上下文中。具体流程如下：
1. 私有数据的注册：pci_set_drvdata
在 probe 函数中，你通过 pci_set_drvdata(dev, mqnic) 把设备私有数据（mqnic 指针）绑定到了 PCI 设备结构体（struct pci_dev *dev）上。这个操作相当于告诉内核：“这个 dev 设备的私有数据在 mqnic 指向的地址，以后用到这个设备时，记得带上它”。
2. 回调函数被调用时，内核自动传递设备指针
当内核调用其他回调函数（如 remove、shutdown）时，会把绑定了私有数据的 struct pci_dev *dev 作为参数传递给这些函数。

**probe 函数代码片段 2：**
```c
// Enable device
 ret = pci_enable_device_mem(pdev);
 if (ret)
 {
 dev_err(dev, "Failed to enable PCI device");
 goto fail_enable_device;
 }
```
此段代码只调用了一个内核函数 pci_enable_device_mem。如果到 Linux 内核源码中去查看这个函数，它的注释中有“Initialize a device for use with Memory space”这样的描述。即“使能”（Enable）此 PCI 设备（包括把设备的 D-State 设置为 D0）的同时，也使能了“像读写内存地址那样”访问它的方式。内核通过向设备的 PCI 配置空间发送相关命令实现这一点，
对此感兴趣的读者可以沿着此函数的调用栈继续深入阅读 Linux 内核源码。

**probe 函数代码片段 3：**
```c
// Set mask
 ret = dma_set_mask_and_coherent(dev, DMA_BIT_MASK(64));
 if (ret)
 {
......
 }
```
dma_set_mask_and_coherent 是内核提供的函数，有两个作用。
第一个作用对应函数名中的 mask，具体来说是设置 PCI 总线控制器，使其可以支持64 位地址 DMA 读写（重点是 Inbound，即设备访问主机内存的方向）。由于目前实际在用的计算机支持最大 64 位地址空间，这个设置相当于给了 PCI 设备访问所有主机内存地址的权限
第二个作用对应函数名中的 coherent，在函数中（见内核代码）为设备设置了一个名为
coherent_dma_mask 的标记，顾名思义是用于申请一致性 DMA 缓存。内核提供了
dma_alloc_coherent 函数供驱动程序调用（本驱动程序也会用到），用于申请一致性 DMA 缓
存（最简单的实现方式就是把这段地址空间的 Cache 功能关闭，使 CPU 和设备访问到的内存
内容持续保持一致）。在申请缓存的过程中会查看设备的 coherent_dma_mask 标记，以判断
可以申请的缓存的地址范围。在本例中，此标记被设置为 DMA_BIT_MASK(64)，意味着地址
范围没有限制。

**probe 函数代码片段 4：**
```c
// Reserve regions
1. ret = pci_request_regions(pdev, DRIVER_NAME);
......
2. mqnic->hw_regs_size = pci_resource_len(pdev, 0);
3. mqnic->hw_regs_phys = pci_resource_start(pdev, 0);
 // Map BAR
4. mqnic->hw_addr = pci_ioremap_bar(pdev, 0);
......
```
第 1 行代码调用内核函数 request_mem_region，其作用仅是通知 Linux 内核把一块内存区域预留出来，意思是“这块内存我已经占用了，别人就不要动了”。具体到本驱动程序，这块内存区域就是操作系统为此 PCI 设备的 BAR0 预留的那段地址空间，即此设备的寄存器地址空间。
第 2 和第 3 行代码获取设备寄存器空间的起始（物理）地址和长度。
第 4 行代码为寄存器空间进行内存映射，具体地说是为 CPU 的内存管理单元（MMU）建立一段虚拟地址到物理地址的映射（保存在页表）。程序指令在此之后访问寄存器的虚拟地址时，MMU 就会从页表中读取虚拟地址对应的表项，以获取寄存器的物理地址，并将物理地址信号发送到总线上去访问寄存器。寄存器空间（虚拟地址）的首地址最终被保存到mqnic->hw_addr，驱动程序运行时会无数次使用这个地址（加上某个偏移量）以访问设备的各个寄存器。
**probe 函数代码片段 5：**
```c
// Read ID registers
 mqnic->fw_id = ioread32(mqnic->hw_addr+MQNIC_REG_FW_ID);
 dev_info(dev, "FW ID: 0x%08x", mqnic->fw_id);
 mqnic->fw_ver = ioread32(mqnic->hw_addr+MQNIC_REG_FW_VER);
 dev_info(dev, "FW version: %d.%d", mqnic->fw_ver >> 16, mqnic->fw_ver & 0xffff);
 mqnic->board_id = ioread32(mqnic->hw_addr+MQNIC_REG_BOARD_ID);
 dev_info(dev, "Board ID: 0x%08x", mqnic->board_id);
 mqnic->board_ver = ioread32(mqnic->hw_addr+MQNIC_REG_BOARD_VER);
 dev_info(dev, "Board version: %d.%d", mqnic->board_ver >> 16, mqnic->board_ver & 0xffff);
......
 mqnic->if_count = ioread32(mqnic->hw_addr+MQNIC_REG_IF_COUNT);
 dev_info(dev, "IF count: %d", mqnic->if_count);
 mqnic->if_stride = ioread32(mqnic->hw_addr+MQNIC_REG_IF_STRIDE);
 dev_info(dev, "IF stride: 0x%08x", mqnic->if_stride);
 mqnic->if_csr_offset = ioread32(mqnic->hw_addr+MQNIC_REG_IF_CSR_OFFSET);
 dev_info(dev, "IF CSR offset: 0x%08x", mqnic->if_csr_offset);
```
从此段代码开始，驱动程序开始从设备寄存器读取信息了。本代码片段中，省略号上面的几行代码只是在获取固件和设备的 ID 以及版本信息，这些信息在接下来的运行中没有什么用处。当然如果想针对某些固件版本或板卡版本执行特殊操作，就会用到这些信息了，不过在本例中并未用到。省略号下面的几行代码比较重要。执行完毕后，if_count 中保存的是接口（Interface）的数量，实际是 2，这就是驱动程序加载后会出现 eth0 和 eth1 两个网络接口的原因。两个接口各有自己的寄存器地址空间，if_stride 中保存的是两个地址空间之间的偏移。if_csr_offset 是各接口寄存器空间的内部保存属性（比如发送队列和接收队列的数量）的那段寄存器相对于接口寄存器空间基地址的偏移量。
**probe 函数代码片段 6：**
```c
// Allocate MSI IRQs
 mqnic->irq_count = pci_alloc_irq_vectors(pdev, 1, 32, PCI_IRQ_MSI);
......
 // Set up interrupts
 for (k = 0; k < mqnic->irq_count; k++)
 {
 ret = pci_request_irq(pdev, k, mqnic_interrupt, 0, mqnic, "mqnic%d-%d", mqnic->id, k);
......
 mqnic->irq_map[k] = pci_irq_vector(pdev, k);
 }
```
首先调用 pci_alloc_irq_vectors 函数为设备申请 MSI 类型（PCI 设备的一种触发中断的方式，可以理解为，设备通过 PCIe 总线和 CPU 内部总线给中断控制器发 MSI 中断消息，中断控制器再发中断信号给处理器的 INT 引脚）的中断号，参数 1 和 32 的意思是希望系统最少分配 1 个，最多分配 32 个中断号。最终能申请到多少个中断号，取决于当前 PCI 设备支持（从其 PCI 配置空间读取）的 MSI 中断的数量。在作者的测试环境上，最终实际获取的中断个数为最大值 32。
接下来调用 pci_request_irq 为每个中断号注册中断处理函数 mqnic_interrupt，后文会讲到此函数的内容。
在驱动程序加载完成后，如果执行命令 cat /proc/interrupts，就可以看到 32 个依次被命名为从 mqnic0-0 到 mqnic0-31 的中断。

**probe 函数代码片段 7：**
```c
// Enable bus mastering for DMA
 pci_set_master(pdev);
```
此处只有一行代码，但非常重要。它调用内核提供的 pci_set_master 函数，通过写命令到PCI 设备的配置空间，给予设备作为 master 主动访问 PCI 总线的权限，这种权限对于设备发起 DMA 读写操作是必需的。
**probe 函数代码片段 8：**
```c
for (k = 0; k < mqnic->if_count; k++)
 {
 dev_info(dev, "Creating interface %d", k);
 ret = mqnic_init_netdev(mqnic, k, mqnic->hw_addr + k*mqnic->if_stride);
......
 }
```
为每个网络接口调用 mqnic_init_netdev 函数。mqnic_init_netdev 函数是驱动程序自己的代码，从函数名看是用来初始化网络设备的，后面会单独介绍。在此之前需要注意它的最后一个输入参数“mqnic->hw_addr + k*mqnic->if_stride”，其中 k 是网络接口的编号，mqnic->if_stride是每个网络接口的寄存器空间的长度，两者相乘后再加上 mqnic->hw_addr（所有寄存器的基地址）就是当前网络接口的寄存器基地址。另外，probe 函数中还有 I2C 接口初始化和 misc 设备注册之类的操作，用于读取板上的EEPROM 以获取 MAC 地址以及提供 ioctl 接口给应用程序以获取设备信息。由于这些都不属于驱动程序的主要功能（收发数据包），在此略过。

#### 5.4.2 网络接口的初始化与注册 {/* #2-网络接口的初始化与注册 */}
在 probe 函数完成了 PCI 总线和中断相关的配置后，会继续调用 mqnic_init_netdev 函数。mqnic_init_netdev 函数负责单个网络接口的初始化和注册。mqnic_init_netdev 函数中各种变量和逻辑的前后联系比较紧密，因此不再分段解析，否则难以理解上下文。
```c
int mqnic_init_netdev(struct mqnic_dev *mdev, int port, u8 __iomem *hw_addr)
{
    struct device *dev = mdev->dev;
    struct net_device *ndev;
    struct mqnic_priv *priv;
    int ret = 0;
    int k;
    u32 desc_block_size;
    //①
    ndev = alloc_etherdev_mqs(sizeof(*priv), MQNIC_MAX_TX_RINGS, MQNIC_MAX_RX_RINGS);
    if (!ndev)
    {
        return -ENOMEM;
    }
    SET_NETDEV_DEV(ndev, dev);
    ndev->dev_port = port;
    //②
    // init private data
    priv = netdev_priv(ndev);
    memset(priv, 0, sizeof(struct mqnic_priv));
    spin_lock_init(&priv->stats_lock);
    priv->ndev = ndev;
    priv->mdev = mdev;
    priv->dev = dev;
    priv->port = port;
    priv->port_up = false;
    //③
    priv->hw_addr = hw_addr;
    priv->csr_hw_addr = hw_addr+mdev->if_csr_offset;
    //④
    // read ID registers
    priv->if_id = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_IF_ID);
    dev_info(dev, "IF ID: 0x%08x", priv->if_id);
    priv->if_features = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_IF_FEATURES);
    dev_info(dev, "IF features: 0x%08x", priv->if_features);
    priv->event_queue_count = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_EVENT_QUEUE_COUNT);
    dev_info(dev, "Event queue count: %d", priv->event_queue_count);
    priv->event_queue_offset = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_EVENT_QUEUE_OFFSET);
    dev_info(dev, "Event queue offset: 0x%08x", priv->event_queue_offset);
    priv->tx_queue_count = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_TX_QUEUE_COUNT);
    dev_info(dev, "TX queue count: %d", priv->tx_queue_count);
    priv->tx_queue_offset = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_TX_QUEUE_OFFSET);
    dev_info(dev, "TX queue offset: 0x%08x", priv->tx_queue_offset);
    priv->tx_cpl_queue_count = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_TX_CPL_QUEUE_COUNT);
    dev_info(dev, "TX completion queue count: %d", priv->tx_cpl_queue_count);
    priv->tx_cpl_queue_offset = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_TX_CPL_QUEUE_OFFSET);
    dev_info(dev, "TX completion queue offset: 0x%08x", priv->tx_cpl_queue_offset);
    priv->rx_queue_count = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_RX_QUEUE_COUNT);
    dev_info(dev, "RX queue count: %d", priv->rx_queue_count);
    priv->rx_queue_offset = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_RX_QUEUE_OFFSET);
    dev_info(dev, "RX queue offset: 0x%08x", priv->rx_queue_offset);
    priv->rx_cpl_queue_count = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_RX_CPL_QUEUE_COUNT);
    dev_info(dev, "RX completion queue count: %d", priv->rx_cpl_queue_count);
    priv->rx_cpl_queue_offset = ioread32(priv->csr_hw_addr +MQNIC_IF_REG_RX_CPL_QUEUE_OFFSET);
    dev_info(dev, "RX completion queue offset: 0x%08x", priv->rx_cpl_queue_offset);
    priv->port_count = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_PORT_COUNT);
    dev_info(dev, "Port count: %d", priv->port_count);
    priv->port_offset = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_PORT_OFFSET);
    dev_info(dev, "Port offset: 0x%08x", priv->port_offset);
    priv->port_stride = ioread32(priv->csr_hw_addr+MQNIC_IF_REG_PORT_STRIDE);
    dev_info(dev, "Port stride: 0x%08x", priv->port_stride);
    if (priv->event_queue_count > MQNIC_MAX_EVENT_RINGS)
        priv->event_queue_count = MQNIC_MAX_EVENT_RINGS;
    if (priv->tx_queue_count > MQNIC_MAX_TX_RINGS)
        priv->tx_queue_count = MQNIC_MAX_TX_RINGS;
    if (priv->tx_cpl_queue_count > MQNIC_MAX_TX_CPL_RINGS)
        priv->tx_cpl_queue_count = MQNIC_MAX_TX_CPL_RINGS;
    if (priv->rx_queue_count > MQNIC_MAX_RX_RINGS)
        priv->rx_queue_count = MQNIC_MAX_RX_RINGS;
    if (priv->rx_cpl_queue_count > MQNIC_MAX_RX_CPL_RINGS)
        priv->rx_cpl_queue_count = MQNIC_MAX_RX_CPL_RINGS;
    if (priv->port_count > MQNIC_MAX_PORTS)
        priv->port_count = MQNIC_MAX_PORTS;
    //⑤
    netif_set_real_num_tx_queues(ndev, priv->tx_queue_count);
    netif_set_real_num_rx_queues(ndev, priv->rx_queue_count);
    // set MAC
    ndev->addr_len = ETH_ALEN;
    memcpy(ndev->dev_addr, mdev->base_mac, ETH_ALEN);
    if (!is_valid_ether_addr(ndev->dev_addr))
    {
        dev_warn(dev, "Bad MAC in EEPROM; using random MAC");
        //⑥
        eth_hw_addr_random(ndev);
    }
    else
    {
        ndev->dev_addr[ETH_ALEN-1] += port;
    }
    priv->hwts_config.flags = 0;
    priv->hwts_config.tx_type = HWTSTAMP_TX_OFF;
    priv->hwts_config.rx_filter = HWTSTAMP_FILTER_NONE;
    //⑦
    // determine desc block size
    iowrite32(0xf << 8,
    hw_addr+priv->tx_queue_offset+MQNIC_QUEUE_ACTIVE_LOG_SIZE_REG);
    priv->max_desc_block_size = 1 << ((ioread32(hw_addr+priv->tx_queue_offset+MQNIC_QUEUE_ACTIVE_LOG_SIZE_REG) >> 8) & 0xf);
    iowrite32(0, hw_addr+priv->tx_queue_offset+MQNIC_QUEUE_ACTIVE_LOG_SIZE_REG);
    dev_info(dev, "Max desc block size: %d", priv->max_desc_block_size);
    priv->max_desc_block_size = priv->max_desc_block_size < MQNIC_MAX_FRAGS ? priv->max_ desc_block_size : MQNIC_MAX_FRAGS;
    desc_block_size = priv->max_desc_block_size < 4 ? priv->max_desc_block_size : 4;
    //⑧
    // allocate rings
    for (k = 0; k < priv->event_queue_count; k++)
    {
        ret = mqnic_create_eq_ring(priv, &priv->event_ring[k], 1024, MQNIC_EVENT_SIZE, k, hw_addr+priv->event_queue_offset+k*MQNIC_EVENT_QUEUE_STRIDE);
    if (ret)
    {
        goto fail;
    }
    }
        for (k = 0; k < priv->tx_queue_count; k++)
    {
        ret = mqnic_create_tx_ring(priv, &priv->tx_ring[k], 1024, MQNIC_DESC_SIZE*desc_ block_size, k, hw_addr+priv->tx_queue_offset+k*MQNIC_QUEUE_STRIDE);
    if (ret)
    {
    goto fail;
    }
    }
        for (k = 0; k < priv->tx_cpl_queue_count; k++)
    {
        ret = mqnic_create_cq_ring(priv, &priv->tx_cpl_ring[k], 1024, MQNIC_CPL_SIZE, k, hw_ addr+priv->tx_cpl_queue_offset+k*MQNIC_CPL_QUEUE_STRIDE);
    if (ret)
    {
        goto fail;
    }
    }
        for (k = 0; k < priv->rx_queue_count; k++)
    {
    ret = mqnic_create_rx_ring(priv, &priv->rx_ring[k], 1024, MQNIC_DESC_SIZE, k, hw_ addr+priv->rx_queue_offset+k*MQNIC_QUEUE_STRIDE);
    if (ret)
    {
        goto fail;
    }
    }
        for (k = 0; k < priv->rx_cpl_queue_count; k++)
    {
    ret = mqnic_create_cq_ring(priv, &priv->rx_cpl_ring[k], 1024, MQNIC_CPL_SIZE, k, hw_ addr+priv->rx_cpl_queue_offset+k*MQNIC_CPL_QUEUE_STRIDE); // TODO configure/constant
    if (ret)
    {
        goto fail;
    }
    }
    for (k = 0; k < priv->port_count; k++)
    {
        ret = mqnic_create_port(priv, &priv->ports[k], k, hw_addr+priv->port_offset+ k*priv->port_stride);
    if (ret)
    {
        goto fail;
    }
    mqnic_port_set_rss_mask(priv->ports[k], 0xffffffff);
    }
    //⑨
    ndev->netdev_ops = &mqnic_netdev_ops;
    //⑩
    ndev->ethtool_ops = &mqnic_ethtool_ops;
    // set up features
    ndev->hw_features = NETIF_F_SG;
    if (priv->if_features & MQNIC_IF_FEATURE_RX_CSUM)
    {
        ndev->hw_features |= NETIF_F_RXCSUM;
    }
    if (priv->if_features & MQNIC_IF_FEATURE_TX_CSUM)
    {
        ndev->hw_features |= NETIF_F_HW_CSUM;
    }
    ndev->features = ndev->hw_features | NETIF_F_HIGHDMA;
    ndev->hw_features |= 0;
    //⑪
    ndev->min_mtu = ETH_MIN_MTU;
    ndev->max_mtu = 1500;
    if (priv->ports[0] && priv->ports[0]->port_mtu)
    {
        ndev->max_mtu = priv->ports[0]->port_mtu-ETH_HLEN;
    }
    netif_carrier_off(ndev);
    //⑫
    ret = register_netdev(ndev);
    if (ret)
    {
        dev_err(dev, "netdev registration failed on port %d", port);
        goto fail;
    }
    priv->registered = 1;
    mdev->ndev[port] = ndev;
    return 0;
    fail:
    mqnic_destroy_netdev(ndev);
    return ret;
}
```
mqnic_init_netdev 函数中依次完成了如下工作（对应代码中注释的编号）。
① 调用内核函数alloc_etherdev_mqs，为此网络接口申请自己的管理结构struct net_device所使用的地址空间（其中包含网络接口私有数据结构 struct mqnic_priv），并设置最多可以支持的发送队列和接收队列的数量。
② 调用 netdev_priv 函数以获取私有数据结构 struct mqnic_priv 的地址，将其赋值给变量priv，并将整个数据结构初始化为 0。
③ 把 priv->hw_addr 赋值为网络接口寄存器空间的首地址，priv->csr_hw_addr 为接口配置相关寄存器的首地址。
④ 读取一系列配置寄存器，获取事件队列（event queue）、发送队列（tx queue）、发送完成队列（tx cpl queue）、接收队列（rx queue）、接收完成队列（rx cpl queue）、端口（port，是一个硬件内部逻辑，负责传输调度和负载均衡，软件不必过多关心，但需要将其激活）的数量和各队列自身的寄存器偏移。队列数量和寄存器偏移都从硬件获取，然后根据获取的具体数据动态配置资源和计算寄存器地址。这是一种比较好的在软件和硬件间进行适配的方法，因为以后每次硬件做相关修改（甚至添加了新的硬件版本）时软件可以自动适配而不必相应修改代码。
⑤ 分别调用函数 netif_set_real_num_tx_queues 和 netif_set_real_num_rx_queues 向内核设置设备真正支持的发送队列和接收队列的数量。
⑥ 调用内核函数 eth_hw_addr_random 随机生成 MAC 地址（浪潮 F37X 加速卡上没有EEPROM 芯片，故无法从硬件读取默认的 MAC 地址），并保存在 net_device 结构中。此后，系统发送数据时内核网络协议栈会使用这个 MAC 地址封装数据包。
⑦ 确定发送描述符块（desc_block_size）的大小（作者测试环境上此数值最后确定为 4）。具体的作用会在 6.3.7 节介绍。
⑧ 从注释“//allocate rings”开始，创建（事件、发送、发送完成、接收、接收完成）队列，即为所有的队列（程序中称之为 ring，因为软硬件都以环形队列的形式管理这些队列）申请队列管理结构（struct mqnic_ring，由软件中的队列管理逻辑所使用，普通内存即可）和描述符缓存（存放所有描述符，软硬件交换数据时使用，为一致性 DMA 内存）所需的内存地址空间。后文会以创建发送队列的 mqnic_create_tx_ring 函数为例详细介绍。
⑨ 为操作系统控制网络接口提供一系列回调函数。其中比较重要的是 open 函数mqnic_open 和数据发送函数 mqnic_start_xmit。
⑩ 为支持 ethtool 工具，提供一系列功能函数。
⑪ 设置协议栈支持的 MTU。
⑫ register_netdev 函数，将网络接口注册到内核。
⑨中设置的系列回调函数如下。后文会详细讲述其中的 mqnic_open 和 mqnic_start_xmit函数，这两个函数分别用于网络接口的打开和数据发送。
```c
static const struct net_device_ops mqnic_netdev_ops = {
 .ndo_open = mqnic_open,
 .ndo_stop = mqnic_close,
 .ndo_start_xmit = mqnic_start_xmit,
 .ndo_get_stats64 = mqnic_get_stats64,
 .ndo_validate_addr = eth_validate_addr,
 .ndo_change_mtu = mqnic_change_mtu,
 .ndo_do_ioctl = mqnic_ioctl,
};
```
#### 5.4.3 创建队列 {/* #3创建队列 */}

在上面⑧中提到了创建队列，这是使用队列进行数据发送和接收的基础。这里以发送队列为例，介绍驱动程序中是如何创建一个队列的。
回顾 mqnic_init_netdev 函数中的下面这段代码
```c
for (k = 0; k < priv->tx_queue_count; k++)
{
        ret = mqnic_create_tx_ring(priv, &priv->tx_ring[k], 1024,
        MQNIC_DESC_SIZE*desc_block_size, k,
        hw_addr+priv->tx_queue_offset+k*MQNIC_QUEUE_STRIDE);
    if (ret)
    {
        goto fail;
    }
 }
```
在这段代码的 for 循环中，每次调用函数 mqnic_create_tx_ring 函数时都会创建一个发送队列。
函数 mqnic_create_tx_ring 的定义如下。
```c
int mqnic_create_tx_ring(struct mqnic_priv *priv, struct mqnic_ring **ring_ptr, int size, int stride, int index, u8 __iomem *hw_addr)；
```
结合 mqnic_create_tx_ring 函数的定义和 mqnic_init_netdev 函数中调用它时的代码，我们可以知道 mqnic_create_tx_ring 函数的主要参数的意义和程序运行时这些参数的值。

• size 是单个队列中描述符的个数，被设置为 1024。
• stride 是前后两个描述符间的地址偏移（距离），等于 MQNIC_DESC_SIZE*desc_ block_size，实际值为 16×4=64。
• index 为当前发送队列的编号。第一个发送队列的编号为 0，之后的发送队列的编号依次加 1，直到最后一个发送队列。
• hw_addr 为当前队列的寄存器基地址。计算方法为 hw_addr+priv->tx_queue_offset+k* MQNIC_QUEUE_STRIDE，即“网络接口的寄存器基地址+所有发送队列的总偏移+当前传输队列的编号×相邻队列间的步长”。
• 函数为了管理这个队列，会创建并初始化数据结构为 struct mqnic_ring 的变量。变量地址最后被保存在网络接口的私有数据结构 struct mqnic_priv

接下来看看具体的创建发送队列的过程。以下是 mqnic_create_tx_ring 函数的代码。
```c
int mqnic_create_tx_ring(struct mqnic_priv *priv, struct mqnic_ring **ring_ptr, int size,
int stride, int index, u8 __iomem *hw_addr)
{
    struct device *dev = priv->dev;
    struct mqnic_ring *ring;
    int ret;
    //①
    ring = kzalloc(sizeof(*ring), GFP_KERNEL);
    if (!ring)
    {
        dev_err(dev, "Failed to allocate TX ring");
        return -ENOMEM;
    }
    //②
    ring->size = roundup_pow_of_two(size);
    ring->full_size = ring->size >> 1;
    ring->size_mask = ring->size-1;
    ring->stride = roundup_pow_of_two(stride);
    ring->desc_block_size = ring->stride/MQNIC_DESC_SIZE;
    ring->log_desc_block_size =
    ring->desc_block_size < 2 ? 0 : ilog2(ring->desc_block_size-1)+1;
    ring->desc_block_size = 1 << ring->log_desc_block_size;
    //③
    ring->tx_info = kvzalloc(sizeof(*ring->tx_info)*ring->size, GFP_KERNEL);
    if (!ring->tx_info)
    {
        dev_err(dev, "Failed to allocate tx_info");
        ret = -ENOMEM;
        goto fail_ring;
    }
    //④
    ring->buf_size = ring->size*ring->stride;
    //⑤
    ring->buf = dma_alloc_coherent(dev, ring->buf_size, &ring->buf_dma_addr,
    GFP_KERNEL);
    if (!ring->buf)
    {
        dev_err(dev, "Failed to allocate TX ring DMA buffer");
        ret = -ENOMEM;
        goto fail_info;
    }
    //⑥
    ring->hw_addr = hw_addr;
    ring->hw_ptr_mask = 0xffff;
    ring->hw_head_ptr = hw_addr+MQNIC_QUEUE_HEAD_PTR_REG;
    ring->hw_tail_ptr = hw_addr+MQNIC_QUEUE_TAIL_PTR_REG;
    ring->head_ptr = 0;
    ring->tail_ptr = 0;
    ring->clean_tail_ptr = 0;
    //⑦
    // deactivate queue
    iowrite32(0, ring->hw_addr+MQNIC_QUEUE_ACTIVE_LOG_SIZE_REG);
    // set base address
    iowrite32(ring->buf_dma_addr, ring->hw_addr+MQNIC_QUEUE_BASE_ADDR_REG+0);
    iowrite32(ring->buf_dma_addr >> 32,
    ring->hw_addr+MQNIC_QUEUE_BASE_ADDR_REG+4);
    // set completion queue index
    iowrite32(0, ring->hw_addr+MQNIC_QUEUE_CPL_QUEUE_INDEX_REG);
    // set pointers
    iowrite32(ring->head_ptr & ring->hw_ptr_mask,
    ring->hw_addr+MQNIC_QUEUE_HEAD_PTR_REG);
    iowrite32(ring->tail_ptr & ring->hw_ptr_mask,
    ring->hw_addr+MQNIC_QUEUE_TAIL_PTR_REG);
    // set size
    iowrite32(ilog2(ring->size) | (ring->log_desc_block_size << 8),
    ring->hw_addr+MQNIC_QUEUE_ACTIVE_LOG_SIZE_REG);
    *ring_ptr = ring;
    return 0;
    fail_info:
    kvfree(ring->tx_info);
    ring->tx_info = NULL;
    fail_ring:
    kfree(ring);
    *ring_ptr = NULL;
    return ret;
}
```
mqnic_create_tx_ring 函数完成了以下工作（对应代码中注释的编号）。
① 为 struct mqnic_ring 结构分配地址空间，这是一个用于管理当前发送队列的数据结构，其成员变量会保存队列的 head、tail、描述符数量（size）、队列缓存（用于存放所有描述符）的地址及长度等信息。
② 计算描述符数量（size）和相邻描述符之间的地址距离（stride）。其实这两个数值原本是以参数传进来的，但此时需要经过 roundup_pow_of_two 操作，使数值扩大到其最接近的2 的指数次幂。如果 size 为 3，经过 roundup_pow_of_two 计算就变成 4（22）；如果 size 为 6，经过 roundup_pow_of_two 计算就变成 8（23）。这样做有利于加速硬件对这些数据的计算和利用，因为硬件可以对其进行移位操作。
③ 申请和描述符同样个数的 struct mqnic_tx_info。在数据发送过程中，此结构用于保存每个描述符对应的数据包管理结构 struct sk_buff 的指针和各分片的数量、物理地址、数据长度等信息。
④ 计算整个队列的描述符缓存的长度，计算方法为“描述符个数×每个描述符占用的地址段长度”。
⑤ 调用内核函数 dma_alloc_coherent，申请一致性 DMA 缓存（存放所有描述符，软件和硬件都可访问）。
⑥ 把队列的寄存器基地址、head 寄存器地址、tail 寄存器地址保存到 struct mqnic_ring的几个成员中。这样，驱动程序在之后读写寄存器时就可以直接使用，不用每次都用偏移去计算地址了。
⑦ 配置了几个寄存器，目的是把描述符缓存的物理地址等信息配置到硬件中。但其实在之后打开网络接口的过程中，所调用的 mqnic_activate_tx_ring 函数中实现了相同的功能（并且激活了队列），所以在此可以忽略。

#### 5.4.4 初始化过程总结 {/* #初始化过程总结 */}
之前的几部分，包括 probe 函数、网络接口的初始化和注册以及创建队列，已经详细地
介绍了一个网卡驱动程序初始化过程中的所有步骤。但细节过于繁多，很难抓住重点，所以
在此化繁为简地总结其中的核心内容。
• PCIe 总线相关的配置，包括设备使能、预留地址空间、给予设备 master 权限等。
• 中断相关的配置，包括向内核申请中断号、设置中断处理函数等。
• 各种地址空间的申请或映射，这些地址空间包括设备的整个寄存器空间、管理网络接
口和队列的私有数据结构空间、各队列的描述符缓存等。
• 网络接口的回调函数设置，包括接口打开函数、数据发送函数等。
• 向内核注册网络接口。

### 5.5 打开网络接口 {/* #打开网络接口 */}
在网络接口初始化和注册的过程中，注册了几个回调函数，其中的 mqnic_open 函数将在驱动程序加载完成后（比如执行 ifconfig eth0 up 命令时）被调用。
```c
static int mqnic_open(struct net_device *ndev)
{
    struct mqnic_priv *priv = netdev_priv(ndev);
    struct mqnic_dev *mdev = priv->mdev;
    int ret = 0;
    mutex_lock(&mdev->state_lock);
    ret = mqnic_start_port(ndev);
    if (ret)
    {
        dev_err(mdev->dev, "Failed to start port: %d", priv->port);
    }
    mutex_unlock(&mdev->state_lock);
    return ret;
}
```
从 mqnic_open 函数的内容看，它主要是调用了函数 mqnic_start_port。
```c
static int mqnic_start_port(struct net_device *ndev)
{
    struct mqnic_priv *priv = netdev_priv(ndev);
    struct mqnic_dev *mdev = priv->mdev;
    int k;
    dev_info(mdev->dev, "mqnic_start_port on port %d", priv->port);
    //①
    // set up event queues
    for (k = 0; k < priv->event_queue_count; k++)
    {
        priv->event_ring[k]->irq = mdev->irq_map[k % mdev->irq_count];
        mqnic_activate_eq_ring(priv, priv->event_ring[k], k % mdev->irq_count);
        mqnic_arm_eq(priv->event_ring[k]);
    }
    //②
    // set up RX completion queues
    for (k = 0; k < priv->rx_cpl_queue_count; k++)
    {
        mqnic_activate_cq_ring(priv, priv->rx_cpl_ring[k], k % priv->event_queue_count);
        priv->rx_cpl_ring[k]->ring_index = k;
        priv->rx_cpl_ring[k]->handler = mqnic_rx_irq;
        netif_napi_add(ndev, &priv->rx_cpl_ring[k]->napi,
        mqnic_poll_rx_cq, NAPI_POLL_WEIGHT);
        napi_enable(&priv->rx_cpl_ring[k]->napi);
        mqnic_arm_cq(priv->rx_cpl_ring[k]);
    }
    //③
    // set up RX queues
    for (k = 0; k < priv->rx_queue_count; k++)
    {
        priv->rx_ring[k]->mtu = ndev->mtu;
    if (ndev->mtu+ETH_HLEN <= PAGE_SIZE)
        priv->rx_ring[k]->page_order = 0;
    else
        priv->rx_ring[k]->page_order =
        ilog2((ndev->mtu+ETH_HLEN+PAGE_SIZE-1)/PAGE_SIZE-1)+1;
        mqnic_activate_rx_ring(priv, priv->rx_ring[k], k);
    }
    //④
    // set up TX completion queues
    for (k = 0; k < priv->tx_cpl_queue_count; k++)
    {
        mqnic_activate_cq_ring(priv, priv->tx_cpl_ring[k], k % priv->event_queue_count);
        priv->tx_cpl_ring[k]->ring_index = k;
        priv->tx_cpl_ring[k]->handler = mqnic_tx_irq;
        netif_tx_napi_add(ndev, &priv->tx_cpl_ring[k]->napi,
        mqnic_poll_tx_cq, NAPI_POLL_WEIGHT);
        napi_enable(&priv->tx_cpl_ring[k]->napi);

        mqnic_arm_cq(priv->tx_cpl_ring[k]);
    }
    //⑤
    // set up TX queues
    for (k = 0; k < priv->tx_queue_count; k++)
    {
        mqnic_activate_tx_ring(priv, priv->tx_ring[k], k);
        priv->tx_ring[k]->tx_queue = netdev_get_tx_queue(ndev, k);
    }
    //⑥
    // configure ports
    for (k = 0; k < priv->port_count; k++)
    {
        // set port MTU
        mqnic_port_set_tx_mtu(priv->ports[k], ndev->mtu+ETH_HLEN);
        mqnic_port_set_rx_mtu(priv->ports[k], ndev->mtu+ETH_HLEN);
    }
    //⑦
    // enable first port
    mqnic_activate_port(priv->ports[0]);
    priv->port_up = true;
    //⑧
    netif_tx_start_all_queues(ndev);
    netif_device_attach(ndev);
    //netif_carrier_off(ndev);
    netif_carrier_on(ndev); // TODO link status monitoring
    return 0;
}
```
mqnic_start_port 函数看起来比较长，但大部分代码是在完成同一件事——激活队列（激活后各队列才会开始运转）。接下来先大致描述该函数的所有工作，再以一个队列激活函数为例来具体解析。
① 激活事件队列，并赋予其产生中断的能力。
② 激活接收完成队列，添加 NAPI 轮询接收处理函数 mqnic_poll_rx_cq（在 6.3.10 节解读），向硬件设置接收完成队列对应的事件队列编号（即告知硬件在填充此接收完成队列后，应该向哪个事件队列报告此事件）。
③ 激活接收队列。
④ 激活发送完成队列，并添加 NAPI 轮询发送处理函数 mqnic_poll_tx_cq（用于释放已发送的数据缓存、更新队列的 tail 指针、唤醒之前因队列满而被停止的发送队列等），向硬件设置发送完成队列对应的事件队列编号。
⑤ 激活发送队列。
⑥ 设置 MMU 到硬件。
⑦ 激活第一个端口，这意味着硬件已经准备好了收发数据。
⑧ 通知内核此网络接口可以工作了。
上面的步骤中激活了一系列的队列，接下来以发送队列的激活函数mqnic_activate_tx_ring为例，看看代码中是如何激活一个队列的。
```c
int mqnic_activate_tx_ring(struct mqnic_priv *priv, struct mqnic_ring *ring, int cpl_index)
{
    // deactivate queue
    iowrite32(0, ring->hw_addr+MQNIC_QUEUE_ACTIVE_LOG_SIZE_REG);
    // set base address
    iowrite32(ring->buf_dma_addr, ring->hw_addr+MQNIC_QUEUE_BASE_ADDR_REG+0);
    iowrite32(ring->buf_dma_addr >> 32,
    ring->hw_addr+MQNIC_QUEUE_BASE_ADDR_REG+4);
    // set completion queue index
    iowrite32(cpl_index, ring->hw_addr+MQNIC_QUEUE_CPL_QUEUE_INDEX_REG);
    // set pointers
    iowrite32(ring->head_ptr & ring->hw_ptr_mask,
    ring->hw_addr+MQNIC_QUEUE_HEAD_PTR_REG);
    iowrite32(ring->tail_ptr & ring->hw_ptr_mask,
    ring->hw_addr+MQNIC_QUEUE_TAIL_PTR_REG);
    // set size and activate queue
    iowrite32(ilog2(ring->size) | (ring->log_desc_block_size << 8) |
    MQNIC_QUEUE_ACTIVE_MASK,
    ring->hw_addr+MQNIC_QUEUE_ACTIVE_LOG_SIZE_REG);
    return 0;
}
```
mqnic_activate_tx_ring 函数其实只做了一件事——写各种不同的寄存器。它先通过写寄存器把队列关闭；然后继续写寄存器把队列的描述符缓存的首地址、缓存中描述符的个数（size，在最后一个语句）配置到硬件；再继续写寄存器告知硬件当前队列的 head 和 tail（已提前初始化为 0），以及发送完成后应通知到的发送完成队列的编号（实际运行时，和当前发送队列的编号相同），最后写值（起作用的是 MQNIC_QUEUE_ACTIVE_MASK 宏定义中的一个位）到寄存器激活队列。

### 5.6 数据发送 {/* #数据发送 */}
经过前文中介绍的步骤，软硬件都已经准备好了收发数据。先来看一下驱动程序在数据发送过程中具体需要做哪些事。在阅读本节前，建议读者先理解前文 6.2 节中的 Corundum 方案中各种队列的角色定位和使用流程。一旦内核协议栈准备好了要发送的数据包，就会调用在网络接口初始化过程中注册的回调函数 mqnic_start_xmit。此函数代码过于冗长，因此下面省略了和时钟及校验和（checksum）计算相关的内容。
```c
netdev_tx_t mqnic_start_xmit(struct sk_buff *skb, struct net_device *ndev)
{
    struct skb_shared_info *shinfo = skb_shinfo(skb);
    struct mqnic_priv *priv = netdev_priv(ndev);
    struct mqnic_ring *ring;
    struct mqnic_tx_info *tx_info;
    struct mqnic_desc *tx_desc;
    int ring_index;
    u32 index;
    bool stop_queue;
    u32 clean_tail_ptr;
    if (unlikely(!priv->port_up))
    {
        goto tx_drop;
    }
    //①
    ring_index = skb_get_queue_mapping(skb);
    if (unlikely(ring_index >= priv->tx_queue_count))
    {
        // queue mapping out of range
        goto tx_drop;
    }
    //②
    ring = priv->tx_ring[ring_index];
    clean_tail_ptr = READ_ONCE(ring->clean_tail_ptr);
    // prefetch for BQL
    netdev_txq_bql_enqueue_prefetchw(ring->tx_queue);
    //③
    index = ring->head_ptr & ring->size_mask;
    //④
    tx_desc = (struct mqnic_desc *)(ring->buf + index*ring->stride);
    tx_info = &ring->tx_info[index];
    ......
    if (shinfo->nr_frags > ring->desc_block_size-1 ||
        (skb->data_len && skb->data_len < 32))
        {
        // too many frags or very short data portion; linearize
    if (skb_linearize(skb))
    {
        goto tx_drop_count;
    }
    }
    //⑤
    // map skb
    if (!mqnic_map_skb(priv, ring, tx_info, tx_desc, skb))
    {
        // map failed
        goto tx_drop_count;
    }
    // count packet
    ring->packets++;
    ring->bytes += skb->len;
    // enqueue
    //⑥
    ring->head_ptr++;
    ......
    stop_queue = mqnic_is_tx_ring_full(ring);
    if (unlikely(stop_queue))
    {
        dev_info(priv->dev, "mqnic_start_xmit TX ring %d full on port %d",
        ring_index, priv->port);
        netif_tx_stop_queue(ring->tx_queue);
    }
    // enqueue on NIC
    #if LINUX_VERSION_CODE >= KERNEL_VERSION(5,2,0)
    if (unlikely(!netdev_xmit_more() || stop_queue))
    #else
    if (unlikely(!skb->xmit_more || stop_queue))
    #endif
    {
        dma_wmb();
        //⑦
        mqnic_tx_write_head_ptr(ring);
    }
    // check if queue restarted
    if (unlikely(stop_queue))
    {
        smp_rmb();
        clean_tail_ptr = READ_ONCE(ring->clean_tail_ptr);
    if (unlikely(!mqnic_is_tx_ring_full(ring)))
    {
        netif_tx_wake_queue(ring->tx_queue);
    }
    }
    return NETDEV_TX_OK;
    tx_drop_count:
    ring->dropped_packets++;
    tx_drop:
    dev_kfree_skb_any(skb);
    return NETDEV_TX_OK;
}
```
内核协议栈在调用此函数发送数据包时传递了两个参数。一个参数是 skb 指针，指向数据结构为 struct sk_buff 的一段数据，内含待发送数据包的地址、长度、协议类型等信息；另一个参数是 ndev，数据结构为 struct net_device，表示当前的网络接口，以它为参数调用netdev_priv 函数可以获取此网络接口的私有数据。对应代码中注释的编号，mqnic_start_xmit 函数依次完成了如下工作。
① 最开始调用函数 skb_get_queue_mapping，是为了从 skb 中获取内核安排此数据包从哪个发送队列发出，ring_index 为此发送队列的索引。
② 顺理成章地使用①中获取的索引从 tx_ring 数组中找到当前发送队列的指针，该指针指向的数据结构为 struct mqnic_ring，即驱动程序中管理此发送队列的数据结构，其所在的内存是由前文描述的初始化过程中调用的 mqnic_create_tx_ring 函数申请的。
③ 对于驱动程序来说，发送一段数据时直接要做的，就是把这段数据的物理地址和长度放在发送队列的一个描述符中，然后把队列 head 加 1，并把 head 写到硬件寄存器。问题是该使用哪个描述符呢？答案是当前队列 head 指向的描述符，它也是队列中第一个未被软件填充的描述符。所以我们看到代码中使用 index = ring->head_ptr & ring->size_mask;计算描述符的索引。
④ 在创建发送队列时，函数 mqnic_create_tx_ring 的 ring->buf = dma_alloc_coherent(......)语句已经把描述符缓存的起始地址保存到了 ring->buf 中，现在就可以用描述符索引计算描述符所在的内存地址了。
⑤ 找到了描述符的地址，接下来调用 mqnic_map_skb 函数去填充描述符。
⑥ 更新软件计数的队列 head。
⑦ 把新 head 写入寄存器告知硬件，此动作会触发硬件开始处理描述符并发送数据。
如果在这个过程中发现队列已经满了，会调用内核函数 netif_tx_stop_queue 通知内核停止使用当前发送队列发送数据。等到 NAPI 轮询处理过程中发现此队列有空描述符时再恢复。
以上就是协议栈发送数据时调用的回调函数 mqnic_start_xmit 的全部内容，但有个问题还没有搞清楚——如何填充描述符？其中涉及的描述符的数据结构如下。
```c
struct mqnic_desc {
 __u16 rsvd0;
 __u16 tx_csum_cmd;
 __u32 len;
 __u64 addr;
};
```
按照 Corundum 方案的设计，每个描述符所使用的数据结构为 struct mqnic_desc，忽略校验和（checksum）功能，数据结构中有用的变量只有 len 和 addr，分别存放待收发数据的长度和物理地址。Corundum 方案中，发送队列和接收队列的描述符采用了同样的数据结构，不同的是数据结构的数量不同。接收队列的每个描述符占 16 字节，内含 1 个 struct mqnic_desc。发送队列的每个描述符占 64 字节，内含 4 个 struct mqnic_desc，对于一些包含（小于或等于 3个）额外分片的数据包，驱动程序就可以把每个分片的长度和物理地址依次填在后面的 3 个struct mqnic_desc 中，没有对应数据的 struct mqnic_desc 全部填 0。这是 Corundum 为了提升数据发送速度提出的优化方法，也是 6.3.5 节的“网络接口的初始化和注册”部分中提到的desc_block_size 为 4 的意义。
⑤中调用了 mqnic_map_skb 函数，此函数负责填充描述符，其代码如下。
```c
static bool mqnic_map_skb(struct mqnic_priv *priv, struct mqnic_ring *ring,
                          struct mqnic_tx_info *tx_info, struct mqnic_desc *tx_desc,
                          struct sk_buff *skb)
{
    struct skb_shared_info *shinfo = skb_shinfo(skb);
    u32 i;
    u32 len;
    dma_addr_t dma_addr;

    // update tx_info
    tx_info->skb = skb;
    tx_info->frag_count = 0;

    for (i = 0; i < shinfo->nr_frags; i++)
    {
        const skb_frag_t *frag = &shinfo->frags[i];
        len = skb_frag_size(frag);
        dma_addr = skb_frag_dma_map(priv->dev, frag, 0, len, DMA_TO_DEVICE);

        if (unlikely(dma_mapping_error(priv->dev, dma_addr)))
        {
            // mapping failed
            goto map_error;
        }

        // write descriptor
        tx_desc[i+1].len = len;
        tx_desc[i+1].addr = dma_addr;

        // update tx_info
        tx_info->frag_count = i+1;
        tx_info->frags[i].len = len;
        tx_info->frags[i].dma_addr = dma_addr;
    }

    for (i = tx_info->frag_count; i < ring->desc_block_size-1; i++)
    {
        tx_desc[i+1].len = 0;
        tx_desc[i+1].addr = 0;
    }

    // map skb
    len = skb_headlen(skb);
    dma_addr = dma_map_single(priv->dev, skb->data, len, PCI_DMA_TODEVICE);

    if (unlikely(dma_mapping_error(priv->dev, dma_addr)))
    {
        // mapping failed
        goto map_error;
    }

    // write descriptor
    tx_desc[0].len = len;
    tx_desc[0].addr = dma_addr;

    // update tx_info
    dma_unmap_addr_set(tx_info, dma_addr, dma_addr);
    dma_unmap_len_set(tx_info, len, len);

    return true;

map_error:
    dev_err(priv->dev, "mqnic_map_skb DMA mapping failed");

    // unmap frags
    for (i = 0; i < tx_info->frag_count; i++)
    {
        dma_unmap_page(priv->dev, tx_info->frags[i].dma_addr, tx_info->frags[i].len,
                       PCI_DMA_TODEVICE);
    }
    // update tx_info
    tx_info->skb = NULL;
    tx_info->frag_count = 0;

    return false;
}
```
在 mqnic_map_skb 函数的第一个 for 循环中，程序把当前数据包中每个（已有代码保证其少于 3 个）分片的物理地址和长度（从 skb 获取）填入发送队列描述符的第二～四个 struct mqnic_desc 中。如果分片不足 3 个，随后第二个 for 循环会把没用到的（不含第一个）struct mqnic_desc 置 0。
随后，处理 skb 中的主要（非分片）数据，同样是获取其长度和物理地址，填入发送队列描述符的第一个 struct mqnic_desc。
另外，mqnic_map_skb 函数中还调用了内核提供的 skb_frag_dma_map 和 dma_map_single函数，并分别使用了参数 DMA_TO_DEVICE 和 PCI_DMA_TODEVICE（这两者是相等的），其作用都是告知 CPU 刷新一次 Cache，如果 Cache 中有这段地址的数据，就把数据更新到主机内存，这样硬件才能确保从主机内存读到最新的数据。协议栈在分配内存的时候并不知道某个数据包最后是否要被硬件读取，因此并没有区别对待，数据包所在的内存通常都是使能了 Cache 的。
#### 5.6.1 内核提供的 DMA 映射函数到底做了什么？ {/* #内核提供的-dma-映射函数到底做了什么 */}
内核提供的 dma_map_single、dma_map_page 等函数会调用各 CPU 体系结构提供
的 arch_sync_dma_for_device 函数。对于这个函数的实现，PowerPC 体系结构的代码写
得比较清晰。在 Linux 内核代码 arch/powerpc/mm/dma-noncoherent.c 中，有下面这么一
段代码：
```c
static void __dma_sync(void *vaddr, size_t size, int direction)
{
 unsigned long start = (unsigned long)vaddr;
 unsigned long end = start + size;
 switch (direction) {
 case DMA_NONE:
 BUG();
 case DMA_FROM_DEVICE:
 /*
 * invalidate only when cache-line aligned otherwise there is
 * the potential for discarding uncommitted data from the cache
 */
if ((start | end) & (L1_CACHE_BYTES - 1))
 flush_dcache_range(start, end);
 else
 invalidate_dcache_range(start, end);
 break;
 case DMA_TO_DEVICE: /* writeback only */
 clean_dcache_range(start, end);
 break;
 case DMA_BIDIRECTIONAL: /* writeback and invalidate */
 flush_dcache_range(start, end);
 break;
 }
}
```
从它的注释中我们可以知道 dma_map_xxx 系列函数的具体操作。
• 对于数据搬移方向为 DMA_FROM_DEVICE（设备向主存写数据）的缓存，把数据Cache 中和这段地址有关的 Cache Line 设置为无效（invalid data cache），作用是让CPU 之后直接从主机内存读取这段地址的数据。对于非 Cache Line 对齐的数据，改为“flash data cache line”，即刷新数据 Cache 中和这段地址有关的 Cache Line，原因是此时 Cache Line 中可能含有不属于此缓存的地址的数据，需要将这些数据先写入内存，再把 Cache Line 设置为无效。
• 对于数据搬移方向为 DMA_TO_DEVICE（设备从主存读数据）的缓存，操作为“clean data cache”，作用是将数据 Cache 中和这段地址有关的 Cache Line 的数据写入主机内存。
• 对于双向缓存，操作为“flash data cache”，也就是先把数据 Cache 中和这段地址有关的 Cache Line 的数据写入内存，然后让 CPU 之后直接从内存读取这段地址的数据。

### 5.7 中断处理 {/* #中断处理 */}
中断是网络数据收发过程中的重要一环，由硬件触发，CPU 响应，最终调用驱动程序提供的中断处理函数进行处理。
Corundum 方案中，关于中断，硬件的行为逻辑（以发送完成中断为例，接收完成中断类似，不考虑异常或错误引发的中断）是这样的：网卡处理完“发送队列”中的一个描述符并完成数据发送后，在往“发送队列”对应的“发送完成队列”填充一个描述符的同时，会往“发送完成队列”对应的“事件队列”也填充一个描述符。如果这个“事件队列”已经被 arm（允许发送中断）了，硬件会通过 PCIe 总线发送一个 MSI 中断消息给中断控制器，随后中断控制器通过处理器核的 INT 引脚触发中断，处理器核进入中断处理流程。
在此过程中，有下面几点需要注意。
• 在所有的“发送队列”和“发送完成队列”中，编号相同的两个队列是一一对应的，即 0 号“发送队列”对应 0 号“发送完成队列”，这种对应关系是在前文描述的mqnic_activate_tx_ring 函数中设置的。
• 多个“发送完成队列”可使用同一个“事件队列”，对应关系在 mqnic_activate_cq_ring函数中设置。
• arm，即允许事件队列触发中断。驱动程序在初始化的过程中，通过调用 mqnic_arm_eq函数，将一个中断编号写入“事件队列”的中断索引寄存器来实现 arm。这里说的中断编号并不是系统的中断号，而只是设备内部的一个编号。在前文描述的 probe 函数中，调用内核函数 pci_request_irq 注册了中断处理函数mqnic_interrupt。对于驱动程序来说，mqnic_interrupt 就是中断处理的入口函数。操作系统的中断处理流程在经过一系列处理（比如查询中断源；写中断控制器寄存器关闭中断，以防止中断嵌套；对某些体系结构，需要做硬件中断号到软件中断号的转换等）后，会调用驱动程序注册的中断处理函数，其代码如下。
```c
static irqreturn_t mqnic_interrupt(int irq, void *data)
{
    struct mqnic_dev *mqnic = data;
    struct mqnic_priv *priv;
    int k, l;
    for (k = 0; k < ARRAY_SIZE(mqnic->ndev); k++)
    {
        if (unlikely(!mqnic->ndev[k]))
            continue;
    priv = netdev_priv(mqnic->ndev[k]);
    if (unlikely(!priv->port_up))
        continue;
    for (l = 0; l < priv->event_queue_count; l++)
    {
    if (unlikely(!priv->event_ring[l]))
        continue;
    if (priv->event_ring[l]->irq == irq)
    {
        mqnic_process_eq(priv->ndev, priv->event_ring[l]);
        mqnic_arm_eq(priv->event_ring[l]);
    }
    }
    }
    return IRQ_HANDLED;
}
```
函数中会处理每个网络接口的每个事件队列，如果中断号能匹配上（即当前产生的中断对应的中断号和当初注册时使用的中断号相同），就为此事件队列依次调用函数mqnic_process_eq（处理事件）和 mqnic_arm_eq（再次允许事件队列触发中断）。在此只关注函数 mqnic_process_eq，其代码如下。
```c
static irqreturn_t mqnic_interrupt(int irq, void *data)
{
    struct mqnic_dev *mqnic = data;
    struct mqnic_priv *priv;
    int k, l;
    for (k = 0; k < ARRAY_SIZE(mqnic->ndev); k++)
    {
        if (unlikely(!mqnic->ndev[k]))
        continue;
        priv = netdev_priv(mqnic->ndev[k]);
        if (unlikely(!priv->port_up))
            continue;
        for (l = 0; l < priv->event_queue_count; l++)
        {
            if (unlikely(!priv->event_ring[l]))
                continue;
            if (priv->event_ring[l]->irq == irq)
            {
                mqnic_process_eq(priv->ndev, priv->event_ring[l]);
                    mqnic_arm_eq(priv->event_ring[l]);
            }
        }
    }
 return IRQ_HANDLED;
}
```
函数中会处理每个网络接口的每个事件队列，如果中断号能匹配上（即当前产生的中断
对应的中断号和当初注册时使用的中断号相同），就为此事件队列依次调用函数
mqnic_process_eq（处理事件）和 mqnic_arm_eq（再次允许事件队列触发中断）。在此只关注
函数 mqnic_process_eq，其代码如下。
```c
void mqnic_process_eq(struct net_device *ndev, struct mqnic_eq_ring *eq_ring)
{
    struct mqnic_priv *priv = netdev_priv(ndev);
    struct mqnic_event *event;
    u32 eq_index;
    u32 eq_tail_ptr;
    int done = 0;
    if (unlikely(!priv->port_up))
    {
        return;
    }
    // read head pointer from NIC
    //①
    mqnic_eq_read_head_ptr(eq_ring);
    eq_tail_ptr = eq_ring->tail_ptr;
    //②
    eq_index = eq_tail_ptr & eq_ring->size_mask;
    //③
    while (eq_ring->head_ptr != eq_tail_ptr)
    {
        event = (struct mqnic_event *)(eq_ring->buf + eq_index*eq_ring->stride);
        if (event->type == MQNIC_EVENT_TYPE_TX_CPL)
        {
            // transmit completion event
            //④
            if (unlikely(event->source > priv->tx_cpl_queue_count))
            {
                dev_err(priv->dev, "mqnic_process_eq on port %d: unknown event source %d (index %d, type %d)", priv->port, event->source, eq_index, event->type);
                print_hex_dump(KERN_ERR, "", DUMP_PREFIX_NONE, 16, 1, event, MQNIC_EVENT_SIZE, true);
            }
            else
            {
                struct mqnic_cq_ring *cq_ring = priv->tx_cpl_ring[event->source];
                if (likely(cq_ring && cq_ring->handler))
                {
                    cq_ring->handler(cq_ring);
                }
            }
        }
        else if (event->type == MQNIC_EVENT_TYPE_RX_CPL)
        {
            // receive completion event
            //⑤
            if (unlikely(event->source > priv->rx_cpl_queue_count))
            {
                dev_err(priv->dev, "mqnic_process_eq on port %d: unknown event source %d (index %d, type %d)", priv->port, event->source, eq_index, event->type);
                print_hex_dump(KERN_ERR, "", DUMP_PREFIX_NONE, 16, 1, event, MQNIC_EVENT_SIZE, true);
            }
            else
            {
                struct mqnic_cq_ring *cq_ring = priv->rx_cpl_ring[event->source];
            if (likely(cq_ring && cq_ring->handler))
            {
                cq_ring->handler(cq_ring);
            }
            }
        }
        else
        {
            dev_err(priv->dev, "mqnic_process_eq on port %d: unknown event type %d (index %d, source %d)", priv->port, event->type, eq_index, event->source);
            print_hex_dump(KERN_ERR, "", DUMP_PREFIX_NONE, 16, 1, event, MQNIC_EVENT_SIZE, true);
        }
        done++;
        //⑥
        eq_tail_ptr++;
        eq_index = eq_tail_ptr & eq_ring->size_mask;
    }
    // update eq tail
    eq_ring->tail_ptr = eq_tail_ptr;
    //⑦
    mqnic_eq_write_tail_ptr(eq_ring);
}
```
对应代码中注释的编号，此函数完成了如下工作。
① “事件队列”（另外还有“接收完成队列”和“发送完成队列”）的生产者是硬件，消费者是软件。所以，和处理发送队列时不同，软件需要（调用函数 mqnic_eq_read_head_ptr）从硬件寄存器读取当前队列的 head。
② 如果新 head 和软件记录的 tail 不相等，就从 tail 开始处理每个事件描述符，此时描述符索引为 eq_index = eq_tail_ptr & eq_ring->size_mask。事件描述符的数据结构 struct mqnic_event 如下，只有两个成员，type 表示事件类型（0：发送完成；1：接收完成），source 表示事件源（即事件的来源为“发送完成队列”或“接收完成队列”）的编号。
```c
struct mqnic_event {
 __u16 type;
 __u16 source;
};
```
③ while 循环中的代码依次处理每个事件描述符。先计算当前事件描述符的虚拟地址（事件队列描述符缓存的首地址+描述符索引×两个描述符之间的跨距），然后读取描述符中的type，根据 type 的值，有不同的处理分支。
④ 如果是“发送完成”，以 source 为索引找到“发送完成队列”，调用其处理函数（cq_ring->handler，此函数指针已在 6.3.6 节介绍的 mqnic_start_port 函数中被赋值为mqnic_tx_irq）。
⑤ 如果是“接收完成”，以 source 为索引找到“接收完成队列”，调用其处理函数（cq_ring->handler，此函数指针已被赋值为 mqnic_rx_irq）。
⑥ 每处理完一个事件描述符，驱动程序都会把自己计数的事件队列的 tail 加 1。
⑦ 在处理完所有的事件描述符后，将新 tail 写入事件队列 tail 寄存器，其作用是告知硬件，软件已处理完毕（从原 tail 到新 tail 之间的）这些描述符。

### 5.8 发送完成处理 {/* #发送完成处理 */}
在 6.3.8 节中提到，中断处理过程中如果发现“事件队列”中某个描述符的事件类型（type）为“发送完成”，则以描述符中的 source 为索引找到“发送完成队列”，以“发送完成队列”管理结构的地址为参数调用处理函数 mqnic_tx_irq。问题是，已经发送完成了，还要做什么呢？
主要是为了释放已经被发送的数据所在的缓存，以及维护队列状态。
mqnic_tx_irq 函数代码如下
```c
void mqnic_tx_irq(struct mqnic_cq_ring *cq)
{
    struct mqnic_priv *priv = netdev_priv(cq->ndev);
    if (likely(priv->port_up))
    {
        napi_schedule_irqoff(&cq->napi);
    }
    else
    {
        mqnic_arm_cq(cq);
    }
}
```
函数本身没有做什么具体的事情，只是调用 napi_schedule_irqoff 函数去调度当前“发送完成队列”对应的 NAPI 处理函数，即 mqnic_poll_tx_cq（此处理函数已在 6.3.6 节描述的mqnic_start_port 函数中被注册到内核），内容如下。
```c
int mqnic_poll_tx_cq(struct napi_struct *napi, int budget)
{
    struct mqnic_cq_ring *cq_ring = container_of(napi, struct mqnic_cq_ring, napi);
    struct net_device *ndev = cq_ring->ndev;
    int done;
    done = mqnic_process_tx_cq(ndev, cq_ring, budget);
    if (done == budget)
    {
        return done;
    }
    napi_complete(napi);
    mqnic_arm_cq(cq_ring);
    return done;
}
```
mqnic_poll_tx_cq 函数完成了三件事。
• 调用 mqnic_process_tx_cq 函数完成实际的发送完成处理。
• 调用内核函数 napi_complete 通知 NAPI 模块此次处理已完成。
• 调用 mqnic_arm_cq 函数再次 arm“发送完成队列”，使其能够继续发送事件到“事件队列”。
重点关注 mqnic_process_tx_cq 函数，其代码如下。

```c
int mqnic_process_tx_cq(struct net_device *ndev, struct mqnic_cq_ring *cq_ring, int napi_ budget)
{
    struct mqnic_priv *priv = netdev_priv(ndev);
    struct mqnic_ring *ring = priv->tx_ring[cq_ring->ring_index];
    struct mqnic_tx_info *tx_info;
    struct mqnic_cpl *cpl;
    u32 cq_index;
    u32 cq_tail_ptr;
    u32 ring_index;
    u32 ring_clean_tail_ptr;
    u32 packets = 0;
    u32 bytes = 0;
    int done = 0;
    int budget = napi_budget;
    if (unlikely(!priv->port_up))
    {
        return done;
    }
    // prefetch for BQL
    netdev_txq_bql_complete_prefetchw(ring->tx_queue);
    // process completion queue
    // read head pointer from NIC
    //①
    mqnic_cq_read_head_ptr(cq_ring);
    cq_tail_ptr = cq_ring->tail_ptr;
    //②
    cq_index = cq_tail_ptr & cq_ring->size_mask;
    while (cq_ring->head_ptr != cq_tail_ptr && done < budget)
    {
        //③
        cpl = (struct mqnic_cpl *)(cq_ring->buf + cq_index*cq_ring->stride);
        //④
        ring_index = cpl->index & ring->size_mask;
        tx_info = &ring->tx_info[ring_index];
        // TX hardware timestamp
        if (unlikely(tx_info->ts_requested))
        {
            struct skb_shared_hwtstamps hwts;
            dev_info(priv->dev, "mqnic_process_tx_cq TX TS requested");
            hwts.hwtstamp = mqnic_read_cpl_ts(priv->mdev, ring, cpl);
            skb_tstamp_tx(tx_info->skb, &hwts);
        }
        // free TX descriptor
        //⑤
        mqnic_free_tx_desc(priv, ring, ring_index, napi_budget);
        packets++;
        bytes += cpl->len;
        done++;
        //⑥
        cq_tail_ptr++;
        cq_index = cq_tail_ptr & cq_ring->size_mask;
    }
    // update CQ tail
    cq_ring->tail_ptr = cq_tail_ptr;
    //⑦
    mqnic_cq_write_tail_ptr(cq_ring);
    // process ring
    // read tail pointer from NIC
    //⑧
    mqnic_tx_read_tail_ptr(ring);
    ring_clean_tail_ptr = READ_ONCE(ring->clean_tail_ptr);
    ring_index = ring_clean_tail_ptr & ring->size_mask;
    while (ring_clean_tail_ptr != ring->tail_ptr)
    {
        tx_info = &ring->tx_info[ring_index];
        if (tx_info->skb)
        break;
        ring_clean_tail_ptr++;
        ring_index = ring_clean_tail_ptr & ring->size_mask;
    }
    // update ring tail
    WRITE_ONCE(ring->clean_tail_ptr, ring_clean_tail_ptr);
    // BQL
    //netdev_tx_completed_queue(ring->tx_queue, packets, bytes);
    // wake queue if it is stopped
    if (netif_tx_queue_stopped(ring->tx_queue) && !mqnic_is_tx_ring_full(ring))
    {
        //⑨
        netif_tx_wake_queue(ring->tx_queue);
    }
    return done;
}
```
对应代码中注释的编号，mqnic_process_tx_cq 函数的主要工作内容如下。
① 和处理事件队列类似，先调用 mqnic_cq_read_head_ptr 函数从硬件读取“发送完成队列”的 head，如果新 head 不等于软件记录的原 tail，说明有新的描述符待处理。
② 以队列的 tail 作为第一个描述符的索引，开始处理所有描述符。“发送完成队列”（和“接收完成队列”）的描述符数据结构如下。其成员 index 表示的是“发送队列”之前完成此次发送时处理的描述符的索引（硬件会将 index 持续加 1，所以需要“与”size_mask 后才能使用）。len 表示发送完成的数据长度。其余成员和时钟及校验功能有关，在此忽略。
③ 先计算当前描述符的虚拟地址（“发送完成队列”描述符缓存的首地址+描述符索引×两个描述符之间的跨距）。
④ 再从此“发送完成队列”的描述符中获取，为完成此次发送而之前处理的“发送队列”的描述符的索引。
⑤ 调用 mqnic_free_tx_desc 函数，释放已经发送的数据所在的缓存。随后统计发包数和发包字节数。
⑥ 更新“发送完成队列”的软件计数的 tail。
⑦ 调用 mqnic_cq_write_tail_ptr 函数将“发送完成队列”的新 tail 写入 tail 寄存器，以通知硬件：软件已处理完从原 tail 到新 tail 之间的描述符。
⑧ 从硬件读取“发送队列”的 tail，用于更新软件记录的 tail，这样在以后发送新的数据时才能知道“发送队列”的哪些描述符是空闲的（已被硬件处理完，软件可填充）。
⑨ 如果“发送队列”之前因为队列满而被内核停止使用了，并且此时队列中有了空闲描述符，就通知内核恢复使用当前“发送队列”。

### 5.9 数据接收 {/* #数据接收 */}
每次数据发送都是由内核协议栈发起的，源头是软件。而每次数据接收都是由中断触发的，源头是硬件。这也很容易理解，谁先拿到数据，谁就先开始干活，然后调动别的模块继续干活。
前文提到，在中断处理过程中，如果发现“事件队列”中某个描述符中的事件类型为“接收完成”，则以描述符中的 source 为索引找到“接收完成队列”，以此“接收完成队列”的管理结构的地址为参数，调用处理函数 mqnic_rx_irq，此函数内容如下。
```c
void mqnic_rx_irq(struct mqnic_cq_ring *cq)
{
    struct mqnic_priv *priv = netdev_priv(cq->ndev);
    if (likely(priv->port_up))
    {
        napi_schedule_irqoff(&cq->napi);
    }
    else
    {
        mqnic_arm_cq(cq);
    }
}
```
函数 mqnic_rx_irq 调用 napi_schedule_irqoff 函数发起 NAPI 调度，随后，NAPI 机制会调用处理函数 mqnic_poll_rx_cq。mqnic_poll_rx_cq 函数是在 6.3.6 节描述的 mqnic_start_port 函数中，激活“接收完成队列”的同时注册到 NAPI 的。函数 mqnic_poll_rx_cq 的代码如下。
```c
int mqnic_poll_rx_cq(struct napi_struct *napi, int budget)
{
    struct mqnic_cq_ring *cq_ring = container_of(napi, struct mqnic_cq_ring, napi);
    struct net_device *ndev = cq_ring->ndev;
    int done;
    done = mqnic_process_rx_cq(ndev, cq_ring, budget);
    if (done == budget)
    {
        return done;
    }
    napi_complete(napi);
    mqnic_arm_cq(cq_ring);
    return done;
}
```
和处理发送完成的过程中调用的 mqnic_poll_tx_cq 函数类似，mqnic_poll_rx_cq 函数也完
成了三件事。
• 调用 mqnic_process_rx_cq 函数完成实际的接收完成处理。
• 调用内核函数 napi_complete 通知内核中的 NAPI 模块已完成此次处理。
• 调用 mqnic_arm_cq 函数再次 arm“接收完成队列”，使其能够继续发送事件到“事
件队列”。

#### 5.9.1 内核提供的解除 DMA 映射的函数到底做了什么？ {/* #内核提供的解除-dma-映射的函数到底做了什么 */}
内核提供的 dma_unmap_page 会调用各 CPU 体系结构提供的 arch_sync_dma_for_cpu函数。其中 PowerPC 体系结构对于这个函数的实现，最终调用的仍然是__dma_sync_page函数，也就是说和“DMA 映射函数”调用了同样的底层函数（见前文“小知识：内核提供的 DMA 映射函数到底做了什么？”）。这就意味着对于 PowerPC 体系结构来说，map 和unmap 没有区别，做什么动作取决于函数的使用者填的参数是 DMA_TO_DEVICE、DMA_FROM_DEVICE 还是 DMA_BIDIRECTIONAL。
一般情况下，如果是驱动程序申请了一段缓存给硬件填充数据，比较典型的是网卡的收包行为。无论是将缓存地址交给硬件前调用的 dma_map_xxx 系列函数，还是接收到数据后驱动程序回收缓存前调用的 dma_unmap_xxx 系列函数，都要使用参数DMA_FROM_DEVICE。所起的作用是“invalid data cache”，就是将数据 Cache 中和这段地址有关的 Cache Line 设置为无效，让 CPU 之后直接从主机内存读取这段地址中的数据。
相反地，如果是驱动程序申请了一段缓存，并在填充数据后交给硬件来读取，比较典型的是网卡的发包行为。无论是将缓存地址交给硬件前调用的 dma_map_xxx 系列函数，还是硬件读取数据后驱动程序回收缓存前调用的 dma_unmap_xxx 系列函数，都要使用参数 DMA_TO_DEVICE。所起的作用是“clean data cache”，就是将数据 Cache中和这段地址有关的 Cache Line 中的数据写入主机内存。
这样看来，发包完成后再去调用 dma_unmap_xxx 系列函数就没什么意义了，收包前调用 dma_map_xxx 系列函数也没什么用，但内核中的很多代码还是在这么做。这么做是为了 map 和 unmap 行为的对称，并且这对其他体系结构可能是有实际意义的。
