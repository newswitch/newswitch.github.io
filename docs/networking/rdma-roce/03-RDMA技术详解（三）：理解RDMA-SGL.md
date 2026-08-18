---
title: "RDMA技术详解（三）：理解RDMA SGL"
sidebar_label: "03. RDMA技术详解（三）：理解RDMA SGL"
sidebar_position: 3
description: "在前面的文章中，我们介绍了RDMA的基本概念和Send/Receive操作。本文将继续深入探讨RDMA中的一个重要概念：SGL（Scatter/Gather List，分散/聚合列表）。"
tags: [RDMA, 网络, 高性能计算]
date: 2025-11-04 10:15:00
categories: 高性能网络
---

# RDMA技术详解（三）：理解RDMA SGL

## 1. 概述 {/* #概述 */}

在前面的文章中，我们介绍了RDMA的基本概念和Send/Receive操作。本文将继续深入探讨RDMA中的一个重要概念：**SGL（Scatter/Gather List，分散/聚合列表）**。

SGL是RDMA中用于描述分散/聚合内存操作的数据结构，它允许在一次RDMA操作中处理多个不连续的内存缓冲区，这对于高性能数据传输至关重要。

## 2. 什么是SGL {/* #什么是sgl */}

**SGL（Scatter/Gather List）**，中文译为"分散/聚合列表"，是一个包含多个内存地址和长度的列表。它允许RDMA硬件在一次操作中：

- **Scatter（分散）**：将一个连续的数据流分散写入多个不连续的内存缓冲区
- **Gather（聚合）**：将多个不连续的内存缓冲区聚合成一个连续的数据流发送出去

在NVMe over PCIe中，I/O命令支持SGL(Scatter Gather List 分散聚合表)和PRP(Physical Region Page 物理(内存)区域页), 而管理命令只支持PRP;而在NVMe over Fabrics中，无论是管理命令还是I/O命令都只支持SGL。

RDMA编程中，SGL(Scatter/Gather List)是最基本的数据组织形式。 SGL是一个数组，该数组中的元素被称之为SGE(Scatter/Gather Element)，每一个SGE就是一个Data Segment(数据段)。RDMA支持Scatter/Gather操作，具体来讲就是RDMA可以支持一个连续的Buffer空间，进行Scatter分散到多个目的主机的不连续的Buffer空间。Gather指的就是多个不连续的Buffer空间，可以Gather到目的主机的一段连续的Buffer空间。

下面我们就来看一下ibv_sge的定义：
```c
struct ibv_sge {
    uint64_t    addr;      // 内存地址
    uint32_t    length;    // 数据长度
    uint32_t    lkey;      // 本地内存键（Local Key）
};
```

## 3. SGL的结构 {/* #sgl的结构 */}

在RDMA中，SGL由多个**SGE（Scatter/Gather Element）**组成。每个SGE描述一个内存段的信息：

```c
struct ibv_sge {
    uint64_t    addr;      // 内存地址
    uint32_t    length;    // 数据长度
    uint32_t    lkey;      // 本地内存键（Local Key）
};
```
1. **addr**：内存缓冲区的起始地址（虚拟地址）
2. **length**：该内存段的长度（字节数）
3. **lkey**：本地内存键，用于验证和保护内存访问。这个键来自于内存注册（MR）时返回的lkey

## 4. ivc_post_send接口 {/* #ivcpostsend接口 */}
而在数据传输中，发送/接收使用的Verbs API为：
ibv_post_send() - post a list of work requests (WRs) to a send queue 将一个WR列表放置到发送队列中 ibv_post_recv() - post a list of work requests (WRs) to a receive queue 将一个WR列表放置到接收队列中

下面以ibv_post_send()为例，说明SGL是如何被放置到RDMA硬件的线缆(Wire)上的。
ibv_post_send()的函数原型

```c
#include <infiniband/verbs.h>

int ibv_post_send(struct ibv_qp *qp,
                  struct ibv_send_wr *wr,
                  struct ibv_send_wr **bad_wr);
```
ibv_post_send（）将以send_wr开头的工作请求（WR）的列表发布到Queue Pair的Send Queue。 它会在第一次失败时停止处理此列表中的WR（可以在发布请求时立即检测到），并通过bad_wr返回此失败的WR。

参数wr是一个ibv_send_wr结构，如中所定义

## 5. ibv_send_wr结构 {/* #ibvsendwr结构 */}
```c
struct ibv_send_wr {
        uint64_t                wr_id;                  /* User defined WR ID */
        struct ibv_send_wr     *next;                   /* Pointer to next WR in list, NULL if last WR */
        struct ibv_sge         *sg_list;                /* Pointer to the s/g array */
        int                     num_sge;                /* Size of the s/g array */
        enum ibv_wr_opcode      opcode;                 /* Operation type */
        int                     send_flags;             /* Flags of the WR properties */
        uint32_t                imm_data;               /* Immediate data (in network byte order) */
        union {
                struct {
                        uint64_t        remote_addr;    /* Start address of remote memory buffer */
                        uint32_t        rkey;           /* Key of the remote Memory Region */
                } rdma;
                struct {
                        uint64_t        remote_addr;    /* Start address of remote memory buffer */
                        uint64_t        compare_add;    /* Compare operand */
                        uint64_t        swap;           /* Swap operand */
                        uint32_t        rkey;           /* Key of the remote Memory Region */
                } atomic;
                struct {
                        struct ibv_ah  *ah;             /* Address handle (AH) for the remote node address */
                        uint32_t        remote_qpn;     /* QP number of the destination QP */
                        uint32_t        remote_qkey;    /* Q_Key number of the destination QP */
                } ud;
        } wr;
};
```
在调用ibv_post_send()之前，必须填充好数据结构wr。 wr是一个链表，每一个结点包含了一个sg_list(i.e. SGL: 由一个或多个SGE构成的数组), sg_list的长度为num_sge。

## 6. RDMA 提交WR流程 {/* #rdma-提交wr流程 */}
下面图解一下SGL和WR链表的对应关系，并说明一个SGL (struct ibv_sge *sg_list)里包含的多个数据段是如何被RDMA硬件聚合成一个连续的数据段的。

### 6.1 第一步：创建SGL {/* #第一步创建sgl */}
![RDMA-1.png](/images/RDMA技术详解（二）/RDMA-1.png)

从上图中，我们可以看到wr链表中的每一个结点都包含了一个SGL，SGL是一个数组，包含一个或多个SGE。通过ibv_post_send提交一个RDMA SEND 请求。这个WR请求中，包括一个sg_list的元素。它是一个SGE链表，SGE指向具体需要发送数据的Buffer

### 6.2 第二步：使用PD进行内存保护 {/* #第二步使用pd进行内存保护 */}
![RDMA-2.png](/images/RDMA技术详解（二）/RDMA-2.png)
我们在发送一段内存地址的时候，我们需要将这段内存地址通过Memory Registration注册到RDMA中。也就是说注册到PD内存保护域当中。一个SGL至少被一个MR保护, 多个MR存在同一个PD中。如图所示一段内存MR可以保护多个SGE元素。

### 6.3 第三步：调用ibv_post_send()将SGL发送到wire上去 {/* #第三步调用ibvpostsend将sgl发送到wire上去 */}
![RDMA-3.png](/images/RDMA技术详解（二）/RDMA-3.png)
在上图中，一个SGL数组包含了3个SGE, 长度分别为N1, N2, N3字节。我们可以看到，这3个buffer并不连续，它们Scatter(分散)在内存中的各个地方。RDMA硬件读取到SGL后，进行Gather(聚合)操作，于是在RDMA硬件的Wire上看到的就是N3+N2+N1个连续的字节。换句话说，通过使用SGL, 我们可以把分散(Scatter)在内存中的多个数据段(不连续)交给RDMA硬件去聚合(Gather)成连续的数据段。

附录一： OFED Verbs
![RDMA-4.png](/images/RDMA技术详解（二）/RDMA-4.png)

## 7. 代码示例 {/* #代码示例 */}

### 7.1 完整的Send操作示例 {/* #完整的send操作示例 */}

```c
// 准备三个分散的缓冲区
char *header = malloc(100);
char *payload = malloc(2000);
char *footer = malloc(50);

// 填充数据
// ...

// 注册内存
struct ibv_mr *mr = ibv_reg_mr(pd, header, 2150,
                                IBV_ACCESS_LOCAL_WRITE |
                                IBV_ACCESS_REMOTE_WRITE);

// 构造SGL
struct ibv_sge sge_list[3];
sge_list[0].addr = (uint64_t)header;
sge_list[0].length = 100;
sge_list[0].lkey = mr->lkey;

sge_list[1].addr = (uint64_t)payload;
sge_list[1].length = 2000;
sge_list[1].lkey = mr->lkey;

sge_list[2].addr = (uint64_t)footer;
sge_list[2].length = 50;
sge_list[2].lkey = mr->lkey;

// 构造Send WR
struct ibv_send_wr send_wr;
memset(&send_wr, 0, sizeof(send_wr));
send_wr.wr_id = 1;
send_wr.sg_list = sge_list;
send_wr.num_sge = 3;
send_wr.opcode = IBV_WR_SEND;

// 提交WR
struct ibv_send_wr *bad_wr;
ibv_post_send(qp, &send_wr, &bad_wr);
```
